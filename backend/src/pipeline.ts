import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { analyzeTranscript } from "./analysis.js";
import { config } from "./config.js";
import { db } from "./firebase.js";
import { sendAnalysis } from "./telegram.js";
import { getAnalysisRecipientChatIds } from "./subscribers.js";
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

async function processVideo(
  channelDocumentId: string,
  channel: Channel,
  video: Video,
  settings: GlobalSettings,
): Promise<"processed" | "waiting" | "failed" | "skipped"> {
  const processReference = db
    .collection("channels")
    .doc(channelDocumentId)
    .collection("videos")
    .doc(video.videoId);

  const shouldProcess = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(processReference);
    if (existing.exists) {
      const status = existing.get("status");
      if (
        status === "completed" ||
        status === "processing" ||
        status === "waiting_transcript"
      ) {
        return false;
      }
    }
    transaction.set(
      processReference,
      {
        ...video,
        status: "processing",
        attemptCount: FieldValue.increment(1),
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });

  if (!shouldProcess) return "skipped";

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
    const recipients = await getAnalysisRecipientChatIds(settings.telegramChatId);
    const deliveries = await Promise.allSettled(
      recipients.map((chatId) =>
        sendAnalysis({
          chatId,
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
          chatId: recipients[index],
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
    }
    const message = getError(error);
    await processReference.set(
      {
        status: "failed",
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
    return "failed";
  }
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
    snapshot.exists &&
    config.models.openrouter.includes(String(snapshot.get("model")))
      ? String(snapshot.get("model"))
      : config.models.openrouter[0] || "";
  const telegramChatId =
    snapshot.exists && snapshot.get("telegramChatId")
      ? String(snapshot.get("telegramChatId"))
      : "";
  if (!model || !config.models.openrouter.includes(model)) {
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
  };
}
