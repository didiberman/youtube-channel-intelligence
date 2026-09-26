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

  const videos = entries
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

  const details = await getVideoDurations(videos.map((video) => video.videoId));
  return videos.map((video) => {
    const durationSeconds = details.get(video.videoId);
    return {
      ...video,
      durationSeconds,
      isShort: durationSeconds === undefined || isShortDuration(durationSeconds),
    };
  });
}

export function isShortDuration(durationSeconds: number) {
  return durationSeconds <= 180;
}

export async function getTranscript(videoId: string): Promise<string> {
  if (!config.apifyApiKey) {
    throw new Error("APIFY_API_KEY is not configured");
  }

  const url = new URL(
    "https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper/run-sync-get-dataset-items",
  );
  url.searchParams.set("token", config.apifyApiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      targetLanguage: "en",
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`Apify returned ${response.status}`);
  }
  const items = (await response.json().catch(() => [])) as ApifyTranscriptItem[];
  return transcriptContent(items[0]?.data);
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

async function getVideoDurations(videoIds: string[]) {
  if (!videoIds.length) return new Map<string, number>();
  const result = await youtubeRequest<{
    items?: Array<{
      id?: string;
      contentDetails?: { duration?: string };
    }>;
  }>("/videos", {
    part: "contentDetails",
    id: videoIds.join(","),
  });
  return new Map(
    (result.items || []).flatMap((item) => {
      if (!item.id || !item.contentDetails?.duration) return [];
      return [[item.id, parseIsoDuration(item.contentDetails.duration)] as const];
    }),
  );
}

function parseIsoDuration(value: string) {
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) return 0;
  return (
    Number(match[1] || 0) * 86_400 +
    Number(match[2] || 0) * 3_600 +
    Number(match[3] || 0) * 60 +
    Number(match[4] || 0)
  );
}

function arrayOf<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

interface ApifyTranscriptItem {
  data?: Array<{ text?: string }>;
}

export class TranscriptUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}

function transcriptContent(segments: ApifyTranscriptItem["data"]): string {
  const transcript = (segments || []).map((segment) => segment.text || "").join(" ");
  const normalized = transcript.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new TranscriptUnavailableError("Apify returned an empty transcript");
  }
  return normalized;
}
