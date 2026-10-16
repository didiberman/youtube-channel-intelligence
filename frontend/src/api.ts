import type {
  Channel,
  ChannelInput,
  GlobalSettings,
  ModelOptions,
  TelegramSubscriber,
} from "./types";

const sessionStorageKey = "channel-intelligence-session";

export function getSessionToken() {
  return localStorage.getItem(sessionStorageKey);
}

export function clearSessionToken() {
  localStorage.removeItem(sessionStorageKey);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getSessionToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  const refreshedToken = response.headers.get("x-refreshed-token");
  if (refreshedToken) {
    localStorage.setItem(sessionStorageKey, refreshedToken);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };

  if (!response.ok) {
    if (response.status === 401 && path !== "/login") {
      clearSessionToken();
      throw new Error(`${payload.error || "Session expired"} (401)`);
    }
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload as T;
}

export const api = {
  login: async (password: string) => {
    const result = await request<{ token: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    localStorage.setItem(sessionStorageKey, result.token);
    return result;
  },
  getConfig: () =>
    request<{ models: ModelOptions; settings: GlobalSettings }>("/config"),
  updateSettings: (settings: GlobalSettings) =>
    request<{ settings: GlobalSettings }>("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  listChannels: () => request<{ channels: Channel[] }>("/channels"),
  listSubscribers: () =>
    request<{ subscribers: TelegramSubscriber[] }>("/subscribers"),
  removeSubscriber: (id: string) =>
    request<{ ok: true }>(`/subscribers/${id}`, { method: "DELETE" }),
  createChannel: (input: ChannelInput) =>
    request<{ channel: Channel }>("/channels", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateChannel: (id: string, input: Partial<ChannelInput & { active: boolean }>) =>
    request<{ channel: Channel }>(`/channels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  rerunChannel: (id: string) =>
    request<{ channel: Channel; outcome: string }>(`/channels/${id}/rerun`, {
      method: "POST",
    }),
  deleteChannel: (id: string) =>
    request<{ ok: true }>(`/channels/${id}`, { method: "DELETE" }),
  runPoll: () =>
    request<{
      queued: number;
      processed: number;
      waiting: number;
      failed: number;
    }>("/poll", {
      method: "POST",
    }),
};
