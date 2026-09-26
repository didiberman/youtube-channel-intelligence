import { config } from "./config.js";
import type { Video } from "./types.js";

const maxTelegramLength = 4000;

export async function sendAnalysis({
  chatId,
  messageThreadId,
  channelTitle,
  video,
  analysis,
}: {
  chatId: string;
  messageThreadId?: number;
  channelTitle: string;
  video: Video;
  analysis: string;
}) {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const heading = [
    `<b>${escapeHtml(channelTitle)}</b>`,
    `<a href="${escapeHtml(video.url)}">${escapeHtml(video.title)}</a>`,
    "",
  ].join("\n");
  const chunks = splitText(analysis, maxTelegramLength - heading.length);

  for (let index = 0; index < chunks.length; index += 1) {
    const text = `${index === 0 ? heading : ""}${markdownToTelegramHtml(chunks[index] || "")}`;
    const response = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createTelegramMessageTarget(chatId, messageThreadId),
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = (await response.json()) as {
      ok?: boolean;
      description?: string;
    };
    if (!response.ok || !body.ok) {
      throw new Error(body.description || `Telegram returned ${response.status}`);
    }
  }
}

export function createTelegramMessageTarget(
  chatId: string,
  messageThreadId?: number,
) {
  return {
    chat_id: chatId,
    ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
  };
}

export async function sendTelegramText(chatId: string, text: string) {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = (await response.json()) as {
    ok?: boolean;
    description?: string;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.description || `Telegram returned ${response.status}`);
  }
}

export function markdownToTelegramHtml(markdown: string) {
  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  const links: string[] = [];
  let value = markdown.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_match, code) => {
    const index = codeBlocks.push(
      `<pre><code>${escapeHtml(String(code).trim())}</code></pre>`,
    );
    return `TELEGRAMCODEBLOCK${index - 1}TOKEN`;
  });
  value = value.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCode.push(`<code>${escapeHtml(String(code))}</code>`);
    return `TELEGRAMINLINECODE${index - 1}TOKEN`;
  });
  value = value.replace(
    /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label, url) => {
      const index = links.push(
        `<a href="${escapeHtml(String(url))}">${escapeHtml(String(label))}</a>`,
      );
      return `TELEGRAMLINK${index - 1}TOKEN`;
    },
  );

  value = escapeHtml(value)
    .split("\n")
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) return `<b>${heading[1]}</b>`;
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) return `• ${bullet[1]}`;
      const quote = line.match(/^\s*&gt;\s?(.+)$/);
      if (quote) return `<blockquote>${quote[1]}</blockquote>`;
      return line;
    })
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");

  return value
    .replace(/TELEGRAMLINK(\d+)TOKEN/g, (_match, index) => links[Number(index)] || "")
    .replace(
      /TELEGRAMINLINECODE(\d+)TOKEN/g,
      (_match, index) => inlineCode[Number(index)] || "",
    )
    .replace(
      /TELEGRAMCODEBLOCK(\d+)TOKEN/g,
      (_match, index) => codeBlocks[Number(index)] || "",
    );
}

function splitText(text: string, limit: number) {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.6) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt < limit * 0.6) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
