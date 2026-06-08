import { XMLParser } from "fast-xml-parser";
import { config } from "./config.js";
import type { Video } from "./types.js";

interface ChannelDetails {
  channelId: string;
  title: string;
  thumbnailUrl?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

export async function resolveChannel(sourceInput: string): Promise<ChannelDetails> {
  if (!config.youtubeApiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const source = sourceInput.trim();
  const parsed = parseChannelInput(source);

  if (parsed.kind === "id") {
    return getChannel({ id: parsed.value });
  }
  if (parsed.kind === "handle") {
    return getChannel({ forHandle: parsed.value });
  }
  if (parsed.kind === "username") {
    return getChannel({ forUsername: parsed.value });
  }

  const search = await youtubeRequest<{
    items?: Array<{ snippet?: { channelId?: string } }>;
  }>("/search", {
    part: "snippet",
    type: "channel",
    maxResults: "1",
    q: parsed.value,
  });
  const channelId = search.items?.[0]?.snippet?.channelId;
  if (!channelId) {
    throw new Error(`No YouTube channel found for "${source}"`);
  }
  return getChannel({ id: channelId });
}

export async function getChannelFeed(channelId: string): Promise<Video[]> {
  const response = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    throw new Error(`YouTube RSS returned ${response.status}`);
  }

  const parsed = xmlParser.parse(await response.text()) as {
    feed?: {
      entry?: unknown;
    };
  };
  const entries = arrayOf<Record<string, unknown>>(parsed.feed?.entry);

  return entries
    .map((entry) => {
      const videoId = String(entry["yt:videoId"] || "");
      const link = arrayOf<Record<string, unknown>>(entry.link).find(
        (candidate) => candidate.rel === "alternate",
      );
      return {
        videoId,
        title: String(entry.title || "Untitled video"),
        publishedAt: String(entry.published || ""),
        url:
          String(link?.href || "") ||
          `https://www.youtube.com/watch?v=${videoId}`,
      };
    })
    .filter((video) => video.videoId && video.publishedAt)
    .sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() -
        new Date(left.publishedAt).getTime(),
    );
}

export async function getTranscript(videoId: string): Promise<string> {
  if (!config.supadataApiKey) {
    throw new Error("SUPADATA_API_KEY is not configured");
  }

  const url = new URL("https://api.supadata.ai/v1/transcript");
  url.searchParams.set(
    "url",
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  );
  url.searchParams.set("text", "true");
  url.searchParams.set("mode", "native");

  const response = await fetch(url, {
    headers: { "x-api-key": config.supadataApiKey },
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json().catch(() => ({}))) as SupadataResponse;

  if (response.status === 206 || payload.error?.error === "transcript-unavailable") {
    throw new TranscriptUnavailableError(
      payload.error?.message || "Captions are not available yet",
    );
  }
  if (response.status === 202 && payload.jobId) {
    return waitForSupadataJob(payload.jobId);
  }
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `Supadata returned ${response.status}`,
    );
  }
  return transcriptContent(payload.content);
}

function parseChannelInput(
  source: string,
):
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string }
  | { kind: "search"; value: string } {
  const directId = source.match(/^UC[a-zA-Z0-9_-]{22}$/);
  if (directId) return { kind: "id", value: directId[0] };

  const normalized = source.startsWith("http") ? source : `https://${source}`;
  try {
    const url = new URL(normalized);
    if (url.hostname.endsWith("youtube.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "channel" && parts[1]) {
        return { kind: "id", value: parts[1] };
      }
      if (parts[0]?.startsWith("@")) {
        return { kind: "handle", value: parts[0].slice(1) };
      }
      if (parts[0] === "user" && parts[1]) {
        return { kind: "username", value: parts[1] };
      }
      if (parts[0] === "c" && parts[1]) {
        return { kind: "search", value: parts[1] };
      }
    }
  } catch {
    // Fall through to handle or name resolution.
  }

  if (source.startsWith("@")) {
    return { kind: "handle", value: source.slice(1) };
  }
  return { kind: "search", value: source };
}

async function getChannel(
  lookup: Record<string, string>,
): Promise<ChannelDetails> {
  const result = await youtubeRequest<{
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
      };
    }>;
  }>("/channels", { part: "snippet", ...lookup });
  const channel = result.items?.[0];
  if (!channel?.id) {
    throw new Error("YouTube channel could not be resolved");
  }
  return {
    channelId: channel.id,
    title: channel.snippet?.title || channel.id,
    thumbnailUrl:
      channel.snippet?.thumbnails?.medium?.url ||
      channel.snippet?.thumbnails?.default?.url,
  };
}

async function youtubeRequest<T>(
  path: string,
  parameters: Record<string, string>,
): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3${path}`);
  Object.entries({ ...parameters, key: config.youtubeApiKey }).forEach(
    ([key, value]) => url.searchParams.set(key, value),
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message || `YouTube API returned ${response.status}`);
  }
  return body;
}

function arrayOf<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

interface SupadataResponse {
  jobId?: string;
  status?: "queued" | "active" | "completed" | "failed";
  content?: string | Array<{ text?: string }>;
  error?: {
    error?: string;
    message?: string;
    details?: string;
  };
}

export class TranscriptUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}

async function waitForSupadataJob(jobId: string): Promise<string> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(1_000);
    const response = await fetch(
      `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`,
      {
        headers: { "x-api-key": config.supadataApiKey },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as SupadataResponse;
    if (!response.ok) {
      throw new Error(
        payload.error?.message || `Supadata job returned ${response.status}`,
      );
    }
    if (payload.status === "completed") {
      return transcriptContent(payload.content);
    }
    if (payload.status === "failed") {
      if (payload.error?.error === "transcript-unavailable") {
        throw new TranscriptUnavailableError(
          payload.error.message || "Captions are not available yet",
        );
      }
      throw new Error(
        payload.error?.message ||
          payload.error?.details ||
          "Supadata transcript job failed",
      );
    }
  }
  throw new Error("Supadata transcript job timed out");
}

function transcriptContent(
  content: SupadataResponse["content"],
): string {
  const transcript =
    typeof content === "string"
      ? content
      : (content || []).map((segment) => segment.text || "").join(" ");
  const normalized = transcript.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new TranscriptUnavailableError("Supadata returned an empty transcript");
  }
  return normalized;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
