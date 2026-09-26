export interface VideoSummary {
  videoId: string;
  title: string;
  publishedAt: string;
  url: string;
  durationSeconds?: number;
  isShort?: boolean;
}

export type AiProvider = "openrouter";

export type ModelOptions = Record<AiProvider, string[]>;

export interface Channel {
  id: string;
  channelId: string;
  title: string;
  thumbnailUrl?: string;
  sourceInput: string;
  active: boolean;
  lastSeenVideo?: VideoSummary;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChannelInput {
  source: string;
}

export interface GlobalSettings {
  provider: AiProvider;
  model: string;
  prompt: string;
  telegramChatId: string;
  telegramMessageThreadId?: number;
}

export interface TelegramSubscriber {
  id: string;
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  active: boolean;
  subscribedAt?: string;
}
