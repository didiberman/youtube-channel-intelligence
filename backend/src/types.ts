export interface Video {
  videoId: string;
  title: string;
  publishedAt: string;
  url: string;
  durationSeconds?: number;
  isShort?: boolean;
}

export interface Channel {
  channelId: string;
  title: string;
  thumbnailUrl?: string;
  sourceInput: string;
  active: boolean;
  lastSeenVideo?: Video;
  createdBy: string;
}

export type AiProvider = "openrouter";

export interface GlobalSettings {
  prompt: string;
  provider: AiProvider;
  model: string;
  telegramChatId: string;
  telegramMessageThreadId?: number;
}

export interface TelegramSubscriber {
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  active: boolean;
}
