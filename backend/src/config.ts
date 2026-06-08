const defaultPrompt =
  "Analyze this video for a crypto market researcher. Summarize the thesis, key claims, assets mentioned, catalysts, risks, and concrete predictions. Separate facts from opinions.";

export const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "didiberman",
  location: process.env.GOOGLE_CLOUD_LOCATION || "global",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  supadataApiKey: process.env.SUPADATA_API_KEY || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
  telegramSubscribePassword: process.env.TELEGRAM_SUBSCRIBE_PASSWORD || "",
  openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionSecret: process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "",
  schedulerAudience: process.env.SCHEDULER_AUDIENCE || "",
  schedulerServiceAccount: process.env.SCHEDULER_SERVICE_ACCOUNT || "",
  tasksQueue: process.env.TASKS_QUEUE || "transcript-retries",
  tasksLocation: process.env.TASKS_LOCATION || "europe-west1",
  allowedEmails: new Set(
    (process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
  allowUnauthenticatedDev:
    process.env.ALLOW_UNAUTHENTICATED_DEV === "true" &&
    process.env.NODE_ENV !== "production",
  models: {
    openrouter: parseList(
      process.env.OPENROUTER_MODEL_ALLOWLIST ||
        "anthropic/claude-sonnet-4.6,google/gemini-3.5-flash,openai/gpt-chat-latest",
    ),
  },
  defaultPrompt,
};

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
