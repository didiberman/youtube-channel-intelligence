import { Router } from "express";
import { z } from "zod";
import { config } from "./config.js";
import {
  getActiveChannelNames,
  isValidSubscriptionPassword,
  subscribeTelegramUser,
  unsubscribeTelegramUser,
} from "./subscribers.js";
import { sendTelegramText } from "./telegram.js";

const updateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({
        id: z.number(),
        type: z.string(),
      }),
      from: z.object({
        id: z.number(),
        username: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
      }),
    })
    .optional(),
});

export const telegramRouter = Router();

telegramRouter.post("/webhook", async (request, response) => {
  if (
    !config.telegramWebhookSecret ||
    request.header("x-telegram-bot-api-secret-token") !==
      config.telegramWebhookSecret
  ) {
    response.status(401).json({ error: "Invalid Telegram webhook secret" });
    return;
  }

  const { message } = updateSchema.parse(request.body);
  if (!message?.text) {
    response.json({ ok: true });
    return;
  }

  const text = message.text.trim();
  const chatId = String(message.chat.id);
  try {
    if (text.toLowerCase() === "/unsubscribe") {
      await unsubscribeTelegramUser(chatId);
      await sendTelegramText(chatId, "You are unsubscribed from new reports.");
      response.json({ ok: true });
      return;
    }

    const password = text.replace(/^\/subscribe(?:@\w+)?\s*/i, "").trim();
    if (!isValidSubscriptionPassword(password)) {
      await sendTelegramText(
        chatId,
        "To subscribe, send: /subscribe PASSWORD",
      );
      response.json({ ok: true });
      return;
    }

    await subscribeTelegramUser(message.chat, message.from);
    const channelNames = await getActiveChannelNames();
    await sendTelegramText(
      chatId,
      createWelcomeMessage(channelNames),
    );
    response.json({ ok: true });
  } catch (error) {
    console.error("Telegram subscription update failed", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    response.json({ ok: true });
  }
});

export function createWelcomeMessage(channelNames: string[]) {
  const channelList = channelNames.length
    ? channelNames.map((name) => `• ${name}`).join("\n")
    : "• No active channels are currently monitored.";
  return [
    "Subscription active.",
    "",
    "From now on, you will receive new video analysis reports for:",
    channelList,
    "",
    "Past analyses will not be sent.",
    "Send /unsubscribe to stop receiving reports.",
  ].join("\n");
}
