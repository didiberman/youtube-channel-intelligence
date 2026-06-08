import { config } from "./config.js";
import type { AiProvider, Video } from "./types.js";

export async function analyzeTranscript({
  provider,
  model,
  prompt,
  transcript,
  video,
  channelTitle,
}: {
  provider: AiProvider;
  model: string;
  prompt: string;
  transcript: string;
  video: Video;
  channelTitle: string;
}) {
  if (!config.models[provider]?.includes(model)) {
    throw new Error(`Model "${model}" is not allowed for ${provider}`);
  }
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const content = [
    `Channel: ${channelTitle}`,
    `Video: ${video.title}`,
    `Published: ${video.publishedAt}`,
    `URL: ${video.url}`,
    "",
    "Transcript:",
    transcript,
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://intel-didiberman.web.app",
      "X-Title": "YouTube Channel Intelligence",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content },
      ],
      temperature: 0.2,
      max_tokens: 8192,
    }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      body.error?.message || `OpenRouter returned ${response.status}`,
    );
  }
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenRouter returned an empty analysis");
  }
  return text;
}
