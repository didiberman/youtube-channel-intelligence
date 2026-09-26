import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { analyzeTranscript } from "./analysis.js";
import { config } from "./config.js";
import { db } from "./firebase.js";
import { sendAnalysis, sendTelegramText } from "./telegram.js";
import { getActiveSubscriberChatIds } from "./subscribers.js";
import { scheduleTranscriptRetry } from "./tasks.js";
import type { Channel, GlobalSettings, Video } from "./types.js";
import {
  getChannelFeed,
  getTranscript,
  TranscriptUnavailableError,
} from "./youtube.js";

export interface PollResult {
  queued: number;
  processed: number;
  waiting: number;
  failed: number;
}

export const maxTranscriptAttempts = 5;

export async function pollChannels(): Promise<PollResult> {
  const [snapshot, settings] = await Promise.all([
    db.collection("channels").where("active", "==", true).get(),
    getGlobalSettings(),
  ]);
  const result: PollResult = { queued: 0, processed: 0, waiting: 0, failed: 0 };

  for (const document of snapshot.docs) {
    const channel = document.data() as Channel;
    try {
      const feed = await getChannelFeed(channel.channelId);
      const newVideos = videosAfterBaseline(feed, channel.lastSeenVideo);
      result.queued += newVideos.length;

      for (const video of newVideos) {
        const outcome = await processVideo(document.id, channel, video, settings);
        if (outcome !== "skipped") result[outcome] += 1;
        if (outcome === "processed") {
          channel.lastSeenVideo = video;
        }
      }
    } catch (error) {
      console.error("Channel poll failed", {
        channelId: channel.channelId,
        error: getError(error),
      });
      result.failed += 1;
    }
  }

  return result;
}

export function videosAfterBaseline(feed: Video[], baseline?: Video) {
  if (!baseline) return [];
  const baselineTime = new Date(baseline.publishedAt).getTime();
  return feed
    .filter(
      (video) =>
        !video.isShort &&
        video.videoId !== baseline.videoId &&
        new Date(video.publishedAt).getTime() > baselineTime,
    )
    .sort(
      (left, right) =>
        new Date(left.publishedAt).getTime() -
        new Date(right.publishedAt).getTime(),
    );
}

export async function processLatestVideo(
  channelDocumentId: string,
  channel: Channel,
  video: Video,
) {
  return processVideo(
    channelDocumentId,
    channel,
    video,
    await getGlobalSettings(),
  );
}

export async function rerunLatestVideo(
  channelDocumentId: string,
  channel: Channel,
  video: Video,
) {
  await db
    .collection("channels")
    .doc(channelDocumentId)
    .collection("videos")
    .doc(video.videoId)
    .set(
      {
        status: "rerun_requested",
        transcriptAttemptCount: 0,
        rerunRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  return processVideo(
    channelDocumentId,
    channel,
    video,
    await getGlobalSettings(),
  );
}

export async function sendLatestVideoToConfiguredThread(
  channelDocumentId: string,
  channel: Channel,
  video: Video,
) {
  if (video.isShort) return "skipped";

  const settings = await getGlobalSettings();
  if (!settings.telegramMessageThreadId) {
    throw new Error("Global Telegram topic ID is not configured");
  }

  const processReference = db
    .collection("channels")
    .doc(channelDocumentId)
    .collection("videos")
    .doc(video.videoId);
  const snapshot = await processReference.get();
  let analysis =
    snapshot.exists && snapshot.get("analysis")
      ? String(snapshot.get("analysis"))
      : "";

  if (!analysis) {
    const transcript = await getTranscript(video.videoId);
    analysis = await analyzeTranscript({
      provider: settings.provider,
      model: settings.model,
      prompt: settings.prompt,
      transcript,
      video,
      channelTitle: channel.title,
    });
    await processReference.set(
      {
        ...video,
        status: "completed",
        transcriptCharacters: transcript.length,
        analysis,
        backfilledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await sendAnalysis({
    chatId: settings.telegramChatId,
    messageThreadId: settings.telegramMessageThreadId,
    channelTitle: channel.title,
    video,
    analysis,
  });
  await processReference.set(
    {
      telegramThreadBackfilledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return "sent";
}

async function processVideo(
  channelDocumentId: string,
  channel: Channel,
  video: Video,
  settings: GlobalSettings,
): Promise<"processed" | "waiting" | "failed" | "skipped"> {
  if (video.isShort) return "skipped";

  const processReference = db
    .collection("channels")
    .doc(channelDocumentId)
    .collection("videos")
    .doc(video.videoId);

  const transcriptAttempt = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(processReference);
    if (existing.exists) {
      const status = existing.get("status");
      if (
        status === "completed" ||
        status === "processing" ||
        status === "waiting_transcript" ||
        status === "transcript_unavailable"
      ) {
        return null;
      }
    }
    const transcriptAttemptCount =
      Number(existing.get("transcriptAttemptCount") || 0) + 1;
    transaction.set(
      processReference,
      {
        ...video,
        status: "processing",
        attemptCount: FieldValue.increment(1),
        transcriptAttemptCount,
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return transcriptAttemptCount;
  });

  if (transcriptAttempt === null) return "skipped";

  try {
    const transcript = await getTranscript(video.videoId);
    const analysis = await analyzeTranscript({
      provider: settings.provider,
      model: settings.model,
      prompt: settings.prompt,
      transcript,
      video,
      channelTitle: channel.title,
    });
    const subscriberChatIds = await getActiveSubscriberChatIds();
    const recipients: Array<{
      chatId: string;
      messageThreadId?: number;
    }> = [
      {
        chatId: settings.telegramChatId,
        messageThreadId: settings.telegramMessageThreadId,
      },
      ...subscriberChatIds
        .filter((chatId) => chatId !== settings.telegramChatId)
        .map((chatId) => ({ chatId })),
    ];
    const deliveries = await Promise.allSettled(
      recipients.map(({ chatId, messageThreadId }) =>
        sendAnalysis({
          chatId,
          messageThreadId,
          channelTitle: channel.title,
          video,
          analysis,
        }),
      ),
    );
    const delivered = deliveries.filter(
      (delivery) => delivery.status === "fulfilled",
    ).length;
    if (!delivered) {
      throw new Error("Telegram delivery failed for every subscriber");
    }
    deliveries.forEach((delivery, index) => {
      if (delivery.status === "rejected") {
        console.error("Telegram subscriber delivery failed", {
          chatId: recipients[index]?.chatId,
          error: getError(delivery.reason),
        });
      }
    });

    const batch = db.batch();
    batch.set(
      processReference,
      {
        status: "completed",
        transcriptCharacters: transcript.length,
        analysis,
        telegramRecipientCount: delivered,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      db.collection("channels").doc(channelDocumentId),
      {
        lastSeenVideo: video,
        lastSuccessAt: FieldValue.serverTimestamp(),
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    return "processed";
  } catch (error) {
    if (error instanceof TranscriptUnavailableError) {
      if (shouldRetryTranscript(transcriptAttempt)) {
        try {
          const retryAt = await scheduleTranscriptRetry(
            channelDocumentId,
            video.videoId,
          );
          await processReference.set(
            {
              status: "waiting_transcript",
              error: error.message,
              retryAt,
              transcriptAttemptsRemaining:
                maxTranscriptAttempts - transcriptAttempt,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          return "waiting";
        } catch (schedulingError) {
          error = new Error(
            `Captions unavailable and retry scheduling failed: ${getError(schedulingError)}`,
          );
        }
      } else {
        error = new TranscriptRetryExhaustedError(
          `Captions unavailable after ${maxTranscriptAttempts} attempts: ${error.message}`,
        );
      }
    }
    const message = getError(error);
    await processReference.set(
      {
        status:
          error instanceof TranscriptRetryExhaustedError
            ? "transcript_unavailable"
            : "failed",
        error: message,
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await db.collection("channels").doc(channelDocumentId).set(
      {
        lastError: message,
        lastErrorAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.error("Video processing failed", {
      channelId: channel.channelId,
      videoId: video.videoId,
      error: message,
    });
    if (
      !(error instanceof TranscriptUnavailableError) &&
      !(error instanceof TranscriptRetryExhaustedError)
    ) {
      try {
        await sendTelegramText(
          settings.telegramChatId,
          `⚠️ Video processing failed for "${video.title}" (${channel.title}): ${message}`,
        );
      } catch (alertError) {
        console.error("Failed to send Telegram failure alert", {
          error: getError(alertError),
        });
      }
    }
    return "failed";
  }
}

export function shouldRetryTranscript(transcriptAttempt: number) {
  return transcriptAttempt < maxTranscriptAttempts;
}

class TranscriptRetryExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptRetryExhaustedError";
  }
}

export async function retryAllFailedTranscripts() {
  const channelsSnapshot = await db.collection("channels").get();
  const result = { retried: 0, processed: 0, stillFailing: 0 };

  for (const channelDocument of channelsSnapshot.docs) {
    const videosSnapshot = await channelDocument.ref
      .collection("videos")
      .where("status", "in", ["failed", "transcript_unavailable"])
      .get();

    for (const videoDocument of videosSnapshot.docs) {
      result.retried += 1;
      const outcome = await retryTranscript(channelDocument.id, videoDocument.id);
      if (outcome === "processed") {
        result.processed += 1;
      } else if (outcome === "failed") {
        result.stillFailing += 1;
      }
    }
  }

  return result;
}

export async function retryTranscript(channelId: string, videoId: string) {
  const channelReference = db.collection("channels").doc(channelId);
  const [channelSnapshot, videoSnapshot] = await Promise.all([
    channelReference.get(),
    channelReference.collection("videos").doc(videoId).get(),
  ]);
  if (!channelSnapshot.exists || !videoSnapshot.exists) {
    throw new Error("Retry target no longer exists");
  }

  const channel = channelSnapshot.data() as Channel;
  if (!channel.active) return "skipped";
  const videoData = videoSnapshot.data() as Video & { status?: string };
  if (videoData.status === "completed") return "skipped";

  await videoSnapshot.ref.set(
    {
      status: "failed",
      retryStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return processVideo(
    channelId,
    channel,
    {
      videoId: videoData.videoId,
      title: videoData.title,
      publishedAt: videoData.publishedAt,
      url: videoData.url,
      durationSeconds: videoData.durationSeconds,
      isShort: videoData.isShort,
    },
    await getGlobalSettings(),
  );
}

function getError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function getGlobalSettings(): Promise<GlobalSettings> {
  const snapshot = await db.collection("settings").doc("global").get();
  const provider = "openrouter";
  const model =
    (snapshot.exists && snapshot.get("model")
      ? String(snapshot.get("model"))
      : config.models.openrouter[0]) || "anthropic/claude-sonnet-4.6";
  const telegramChatId =
    snapshot.exists && snapshot.get("telegramChatId")
      ? String(snapshot.get("telegramChatId"))
      : "";
  if (!model) {
    throw new Error("Global AI model is not configured");
  }
  if (!telegramChatId) {
    throw new Error("Global Telegram chat ID is not configured");
  }
  return {
    prompt:
      snapshot.exists && snapshot.get("prompt")
        ? String(snapshot.get("prompt"))
        : config.defaultPrompt,
    provider,
    model,
    telegramChatId,
    telegramMessageThreadId:
      snapshot.exists && snapshot.get("telegramMessageThreadId")
        ? Number(snapshot.get("telegramMessageThreadId"))
        : undefined,
  };
}
