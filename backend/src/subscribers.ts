import { FieldValue } from "firebase-admin/firestore";
import { config } from "./config.js";
import { db } from "./firebase.js";

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

export async function subscribeTelegramUser(
  chat: TelegramChat,
  user: TelegramUser,
) {
  if (chat.type !== "private") {
    throw new Error("Subscriptions are only available in private bot chats.");
  }
  const chatId = String(chat.id);
  await db.collection("telegramSubscribers").doc(chatId).set(
    {
      chatId,
      telegramUserId: String(user.id),
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      active: true,
      subscribedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function unsubscribeTelegramUser(chatId: string) {
  await db.collection("telegramSubscribers").doc(chatId).set(
    {
      active: false,
      unsubscribedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getAnalysisRecipientChatIds(adminChatId: string) {
  const snapshot = await db
    .collection("telegramSubscribers")
    .where("active", "==", true)
    .get();
  return [
    ...new Set([
      adminChatId,
      ...snapshot.docs.map((document) => String(document.get("chatId"))),
    ]),
  ].filter(Boolean);
}

export async function getActiveChannelNames() {
  const snapshot = await db
    .collection("channels")
    .where("active", "==", true)
    .get();
  return snapshot.docs
    .map((document) => String(document.get("title") || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function isValidSubscriptionPassword(value: string) {
  return Boolean(
    config.telegramSubscribePassword &&
      value === config.telegramSubscribePassword,
  );
}
