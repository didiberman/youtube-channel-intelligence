import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Router } from "express";
import { z } from "zod";
import { loginWithPassword, requireScheduler, requireUser } from "./auth.js";
import { config } from "./config.js";
import { db } from "./firebase.js";
import {
  pollChannels,
  processLatestVideo,
  rerunLatestVideo,
  retryAllFailedTranscripts,
  retryTranscript,
  sendLatestVideoToConfiguredThread,
} from "./pipeline.js";
import type { Channel } from "./types.js";
import { getChannelFeed, resolveChannel } from "./youtube.js";

const providerSchema = z.literal("openrouter");

const channelInput = z.object({
  source: z.string().trim().min(2).max(300),
});

const updateInput = z.object({ active: z.boolean() });

export const apiRouter = Router();

apiRouter.post("/login", (request, response) => {
  const input = z
    .object({ password: z.string().min(1).max(200) })
    .parse(request.body);
  const token = loginWithPassword(input.password);
  if (!token) {
    response.status(401).json({ error: "Invalid password" });
    return;
  }
  response.json({ token });
});

apiRouter.get("/config", requireUser, async (_request, response) => {
  const settings = await getGlobalSettings();
  response.json({
    models: config.models,
    settings,
  });
});

apiRouter.put("/settings", requireUser, async (request, response) => {
  const input = z
    .object({
      prompt: z.string().trim().min(10).max(20_000),
      provider: providerSchema,
      model: z.string().trim().min(2).max(200),
      telegramChatId: z.string().trim().min(2).max(100),
      telegramMessageThreadId: z.number().int().positive().optional(),
    })
    .parse(request.body);
  await db.collection("settings").doc("global").set(
    {
      ...input,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: request.user?.uid || "unknown",
    },
    { merge: true },
  );
  response.json({ settings: input });
});

apiRouter.get("/channels", requireUser, async (_request, response) => {
  const snapshot = await db.collection("channels").orderBy("createdAt", "desc").get();
  response.json({
    channels: snapshot.docs.map((document) => serialize(document.id, document.data())),
  });
});

apiRouter.get("/subscribers", requireUser, async (_request, response) => {
  const snapshot = await db
    .collection("telegramSubscribers")
    .orderBy("subscribedAt", "desc")
    .get();
  response.json({
    subscribers: snapshot.docs.map((document) =>
      serialize(document.id, document.data()),
    ),
  });
});

apiRouter.delete("/subscribers/:id", requireUser, async (request, response) => {
  await db
    .collection("telegramSubscribers")
    .doc(routeParameter(request.params.id))
    .set(
      {
        active: false,
        removedByAdminAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  response.json({ ok: true });
});

apiRouter.post("/channels", requireUser, async (request, response) => {
  const input = channelInput.parse(request.body);

  const resolved = await resolveChannel(input.source);
  const feed = await getChannelFeed(resolved.channelId);
  const latestVideo = feed.find((video) => !video.isShort);
  const latestFeedVideo = feed[0];
  const reference = db.collection("channels").doc(resolved.channelId);
  const existing = await reference.get();
  if (existing.exists) {
    response.status(409).json({ error: "This channel is already monitored" });
    return;
  }

  const channel: Channel = {
    ...resolved,
    sourceInput: input.source,
    active: true,
    lastSeenVideo: latestFeedVideo,
    createdBy: request.user?.uid || "unknown",
  };
  await reference.set({
    ...channel,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const outcome = latestVideo
    ? await processLatestVideo(reference.id, channel, latestVideo)
    : "skipped";

  response.status(201).json({
    channel: serialize(reference.id, {
      ...channel,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }),
    outcome,
  });
});

apiRouter.patch("/channels/:id", requireUser, async (request, response) => {
  const input = updateInput.parse(request.body);
  const reference = db.collection("channels").doc(routeParameter(request.params.id));
  const existing = await reference.get();
  if (!existing.exists) {
    response.status(404).json({ error: "Channel not found" });
    return;
  }

  await reference.set(
    { ...input, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  const updated = await reference.get();
  response.json({ channel: serialize(updated.id, updated.data() || {}) });
});

apiRouter.post("/channels/:id/rerun", requireUser, async (request, response) => {
  const channelId = routeParameter(request.params.id);
  const reference = db.collection("channels").doc(channelId);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    response.status(404).json({ error: "Channel not found" });
    return;
  }

  const channel = snapshot.data() as Channel;
  const latestVideo = (await getChannelFeed(channel.channelId)).find(
    (video) => !video.isShort,
  );
  if (!latestVideo) {
    response.status(404).json({ error: "No videos found for this channel" });
    return;
  }

  const outcome = await rerunLatestVideo(channelId, channel, latestVideo);
  const updated = await reference.get();
  response.json({
    outcome,
    channel: serialize(updated.id, updated.data() || {}),
  });
});

apiRouter.post(
  "/channels/:id/backfill-thread",
  requireUser,
  async (request, response) => {
    const channelId = routeParameter(request.params.id);
    const reference = db.collection("channels").doc(channelId);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      response.status(404).json({ error: "Channel not found" });
      return;
    }

    const channel = snapshot.data() as Channel;
    const latestVideo = (await getChannelFeed(channel.channelId)).find(
      (video) => !video.isShort,
    );
    if (!latestVideo) {
      response.status(404).json({
        error: "No non-Short videos found for this channel",
      });
      return;
    }

    response.json({
      outcome: await sendLatestVideoToConfiguredThread(
        channelId,
        channel,
        latestVideo,
      ),
      video: latestVideo,
    });
  },
);

apiRouter.delete("/channels/:id", requireUser, async (request, response) => {
  await db.recursiveDelete(
    db.collection("channels").doc(routeParameter(request.params.id)),
  );
  response.json({ ok: true });
});

apiRouter.post("/poll", requireUser, async (_request, response) => {
  response.json(await pollChannels());
});

apiRouter.post("/retry-failed", requireUser, async (_request, response) => {
  response.json(await retryAllFailedTranscripts());
});

export const internalRouter = Router();
internalRouter.post("/poll", requireScheduler, async (_request, response) => {
  response.json(await pollChannels());
});
internalRouter.post(
  "/retry-failed",
  requireScheduler,
  async (_request, response) => {
    response.json(await retryAllFailedTranscripts());
  },
);
internalRouter.post("/retry", requireScheduler, async (request, response) => {
  const input = z
    .object({
      channelId: z.string().min(1),
      videoId: z.string().min(1),
    })
    .parse(request.body);
  response.json({ outcome: await retryTranscript(input.channelId, input.videoId) });
});

function serialize(id: string, value: Record<string, unknown>) {
  return {
    id,
    ...Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        field instanceof Timestamp ? field.toDate().toISOString() : field,
      ]),
    ),
  };
}

function routeParameter(value: string | string[] | undefined) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid route parameter");
  }
  return value;
}

async function getGlobalSettings() {
  const snapshot = await db.collection("settings").doc("global").get();
  const provider = "openrouter";
  const model =
    (snapshot.exists && snapshot.get("model")
      ? String(snapshot.get("model"))
      : config.models.openrouter[0]) || "anthropic/claude-sonnet-4.6";
  return {
    prompt:
      (snapshot.exists ? snapshot.get("prompt") : undefined) ||
      config.defaultPrompt,
    provider,
    model,
    telegramChatId:
      (snapshot.exists ? snapshot.get("telegramChatId") : undefined) || "",
    telegramMessageThreadId:
      (snapshot.exists
        ? snapshot.get("telegramMessageThreadId")
        : undefined) || undefined,
  };
}
