import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LogOut,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Trash2,
  UserRoundCheck,
  Youtube,
} from "lucide-react";
import { api, clearSessionToken, getSessionToken } from "./api";
import type {
  Channel,
  ChannelInput,
  GlobalSettings,
  ModelOptions,
  TelegramSubscriber,
} from "./types";

const fallbackPrompt =
  "Analyze this video for a crypto market researcher. Summarize the thesis, key claims, assets mentioned, catalysts, risks, and concrete predictions. Separate facts from opinions.";

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(getSessionToken()));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [subscribers, setSubscribers] = useState<TelegramSubscriber[]>([]);
  const [models, setModels] = useState<ModelOptions>({
    openrouter: ["anthropic/claude-sonnet-4.6"],
  });
  const [settings, setSettings] = useState<GlobalSettings>({
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    prompt: fallbackPrompt,
    telegramChatId: "",
  });
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    void loadDashboard();
  }, [authenticated]);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const [config, channelData, subscriberData] = await Promise.all([
        api.getConfig(),
        api.listChannels(),
        api.listSubscribers(),
      ]);
      setModels(config.models);
      setSettings(config.settings);
      setChannels(channelData.channels);
      setSubscribers(subscriberData.subscribers);
    } catch (caught) {
      setError(getError(caught));
      if (caught instanceof Error && caught.message.includes("401")) {
        clearSessionToken();
        setAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createChannel(input: ChannelInput) {
    setError("");
    setMessage("");
    const { channel } = await api.createChannel(input);
    setChannels((current) => [channel, ...current]);
    setMessage(`${channel.title} is now being monitored.`);
  }

  async function removeChannel(id: string) {
    if (!window.confirm("Stop monitoring this channel?")) return;
    setError("");
    try {
      await api.deleteChannel(id);
      setChannels((current) => current.filter((channel) => channel.id !== id));
    } catch (caught) {
      setError(getError(caught));
    }
  }

  async function toggleChannel(channel: Channel) {
    setError("");
    try {
      const result = await api.updateChannel(channel.id, {
        active: !channel.active,
      });
      setChannels((current) =>
        current.map((item) => (item.id === channel.id ? result.channel : item)),
      );
    } catch (caught) {
      setError(getError(caught));
    }
  }

  async function rerunChannel(channel: Channel) {
    setError("");
    setMessage("");
    try {
      const result = await api.rerunChannel(channel.id);
      setChannels((current) =>
        current.map((item) => (item.id === channel.id ? result.channel : item)),
      );
      setMessage(
        result.outcome === "processed"
          ? `${channel.title}'s latest video was rerun and sent to Telegram.`
          : `${channel.title}'s rerun status: ${result.outcome}.`,
      );
    } catch (caught) {
      setError(getError(caught));
    }
  }

  async function removeSubscriber(subscriber: TelegramSubscriber) {
    const name = subscriber.username
      ? `@${subscriber.username}`
      : subscriber.firstName || subscriber.chatId;
    if (!window.confirm(`Remove ${name} from Telegram reports?`)) return;
    setError("");
    try {
      await api.removeSubscriber(subscriber.id);
      setSubscribers((current) =>
        current.map((item) =>
          item.id === subscriber.id ? { ...item, active: false } : item,
        ),
      );
    } catch (caught) {
      setError(getError(caught));
    }
  }

  async function updateGlobalSettings(input: GlobalSettings) {
    setError("");
    setMessage("");
    const result = await api.updateSettings(input);
    setSettings(result.settings);
    setMessage("Global analysis settings were saved.");
  }

  async function runPoll() {
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const result = await api.runPoll();
      setMessage(
        `Poll complete: ${result.processed} processed, ${result.waiting} waiting for captions, ${result.failed} failed.`,
      );
      await loadDashboard();
    } catch (caught) {
      setError(getError(caught));
    } finally {
      setRunning(false);
    }
  }

  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Radio size={22} />
          </div>
          <div>
            <strong>Channel Intelligence</strong>
            <span>YouTube research automation</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="user-email">Password protected</span>
          <button
            className="button ghost"
            onClick={() => {
              clearSessionToken();
              setAuthenticated(false);
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">
              <span className="live-dot" />
              Automated every 3 hours
            </div>
            <h1>Turn every new upload into actionable research.</h1>
            <p>
              Monitor channels, extract available captions, analyze them with
              OpenRouter, and deliver the result to Telegram.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={running}
            onClick={() => void runPoll()}
          >
            <RefreshCw size={17} className={running ? "spin" : ""} />
            {running ? "Polling..." : "Run now"}
          </button>
        </section>

        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice success">{message}</div>}

        <GlobalSettingsForm
          models={models}
          settings={settings}
          onSave={updateGlobalSettings}
        />

        <SubscribersPanel
          subscribers={subscribers}
          onRemove={removeSubscriber}
        />

        <section className="dashboard-grid">
          <ChannelForm
            onSubmit={createChannel}
          />
          <Stats channels={channels} />
        </section>

        <section className="channels-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Watchlist</span>
              <h2>Monitored channels</h2>
            </div>
            <span className="count-badge">{channels.length}</span>
          </div>

          {loading ? (
            <div className="empty-state">Loading channels...</div>
          ) : channels.length === 0 ? (
            <div className="empty-state">
              <Youtube size={34} />
              <strong>No channels yet</strong>
              <span>Add a channel to establish its latest-video baseline.</span>
            </div>
          ) : (
            <div className="channel-list">
              {channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  onDelete={removeChannel}
                  onRerun={rerunChannel}
                  onToggle={toggleChannel}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SubscribersPanel({
  subscribers,
  onRemove,
}: {
  subscribers: TelegramSubscriber[];
  onRemove: (subscriber: TelegramSubscriber) => Promise<void>;
}) {
  const activeSubscribers = subscribers.filter((subscriber) => subscriber.active);
  return (
    <section className="panel subscribers-panel">
      <div className="panel-title">
        <div className="icon-box green">
          <UserRoundCheck size={20} />
        </div>
        <div>
          <h2>Telegram subscribers</h2>
          <p>
            Users subscribe by sending <code>/subscribe PASSWORD</code> to the
            bot. They can stop with <code>/unsubscribe</code>.
          </p>
        </div>
        <span className="count-badge">{activeSubscribers.length}</span>
      </div>
      {subscribers.length === 0 ? (
        <div className="empty-state compact">
          No Telegram subscribers yet.
        </div>
      ) : (
        <div className="subscriber-list">
          {subscribers.map((subscriber) => {
            const displayName = subscriber.username
              ? `@${subscriber.username}`
              : [subscriber.firstName, subscriber.lastName]
                  .filter(Boolean)
                  .join(" ") || subscriber.chatId;
            return (
              <div className="subscriber-row" key={subscriber.id}>
                <div>
                  <strong>{displayName}</strong>
                  <span>
                    Chat {subscriber.chatId}
                    {subscriber.subscribedAt
                      ? ` · ${formatDate(subscriber.subscribedAt)}`
                      : ""}
                  </span>
                </div>
                <span className={`status ${subscriber.active ? "active" : ""}`}>
                  {subscriber.active ? "Active" : "Inactive"}
                </span>
                {subscriber.active && (
                  <button
                    className="icon-button danger"
                    title="Remove subscriber"
                    onClick={() => void onRemove(subscriber)}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.login(password);
      onLogin();
    } catch (caught) {
      setError(getError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="brand-mark large">
          <Radio size={30} />
        </div>
        <span className="section-kicker">Private workspace</span>
        <h1>Channel Intelligence</h1>
        <p>
          Enter the admin password to manage monitoring and analysis.
        </p>
        <label>
          Password
          <input
            autoFocus
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Admin password"
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="button primary wide" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function ChannelForm({
  onSubmit,
}: {
  onSubmit: (input: ChannelInput) => Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ source });
      setSource("");
    } catch (caught) {
      setError(getError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel add-panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-title">
        <div className="icon-box red">
          <Plus size={20} />
        </div>
        <div>
          <h2>Add a channel</h2>
          <p>The current latest upload is analyzed immediately.</p>
        </div>
      </div>

      <label>
        Channel name, @handle, or URL
        <input
          required
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="@coinbureau or youtube.com/@coinbureau"
        />
      </label>

      {error && <div className="notice error compact">{error}</div>}

      <button className="button primary" disabled={submitting}>
        <Plus size={17} />
        {submitting ? "Resolving channel..." : "Start monitoring"}
      </button>
    </form>
  );
}

function GlobalSettingsForm({
  models,
  settings,
  onSave,
}: {
  models: ModelOptions;
  settings: GlobalSettings;
  onSave: (settings: GlobalSettings) => Promise<void>;
}) {
  const [value, setValue] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setValue(settings), [settings]);
  useEffect(() => {
    if (!models[value.provider].includes(value.model)) {
      setValue((current) => ({
        ...current,
        model: models[current.provider][0] || "",
      }));
    }
  }, [models, value.model, value.provider]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(value);
    } catch (caught) {
      setError(getError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel global-prompt" onSubmit={(event) => void submit(event)}>
      <div className="panel-title">
        <div className="icon-box purple">
          <Radio size={20} />
        </div>
        <div>
          <h2>Global analysis settings</h2>
          <p>These settings apply to every monitored channel.</p>
        </div>
      </div>
      <label>
        OpenRouter model
        <select
          value={value.model}
          onChange={(event) =>
            setValue((current) => ({
              ...current,
              provider: "openrouter",
              model: event.target.value,
            }))
          }
        >
          {models.openrouter.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prompt
        <textarea
          required
          rows={7}
          value={value.prompt}
          onChange={(event) =>
            setValue((current) => ({
              ...current,
              prompt: event.target.value,
            }))
          }
        />
      </label>
      <label>
        Telegram chat ID
        <input
          required
          value={value.telegramChatId}
          onChange={(event) =>
            setValue((current) => ({
              ...current,
              telegramChatId: event.target.value,
            }))
          }
        />
      </label>
      {error && <div className="notice error compact">{error}</div>}
      <div className="prompt-actions">
        <span>
          New and existing channels use these settings on their next video.
        </span>
        <button
          className="button primary"
          disabled={saving || sameSettings(value, settings)}
        >
          <Save size={16} />
          {saving ? "Saving..." : "Save global settings"}
        </button>
      </div>
    </form>
  );
}

function Stats({ channels }: { channels: Channel[] }) {
  const active = channels.filter((channel) => channel.active).length;
  const latest = useMemo(
    () =>
      channels
        .map((channel) => channel.lastSeenVideo?.publishedAt)
        .filter(Boolean)
        .sort()
        .at(-1),
    [channels],
  );

  return (
    <aside className="panel stats-panel">
      <div className="stat">
        <div className="icon-box blue">
          <Youtube size={20} />
        </div>
        <div>
          <span>Channels</span>
          <strong>{channels.length}</strong>
        </div>
      </div>
      <div className="stat">
        <div className="icon-box green">
          <CheckCircle2 size={20} />
        </div>
        <div>
          <span>Active monitors</span>
          <strong>{active}</strong>
        </div>
      </div>
      <div className="stat">
        <div className="icon-box purple">
          <Clock3 size={20} />
        </div>
        <div>
          <span>Newest baseline</span>
          <strong className="small">
            {latest ? formatDate(latest) : "Not established"}
          </strong>
        </div>
      </div>
      <div className="pipeline">
        <span className="section-kicker">Pipeline</span>
        <div><Youtube size={16} /> RSS discovery</div>
        <div><Play size={16} /> Caption extraction</div>
        <div><Radio size={16} /> OpenRouter analysis</div>
        <div><Bot size={16} /> Telegram delivery</div>
      </div>
    </aside>
  );
}

function ChannelCard({
  channel,
  onDelete,
  onRerun,
  onToggle,
}: {
  channel: Channel;
  onDelete: (id: string) => Promise<void>;
  onRerun: (channel: Channel) => Promise<void>;
  onToggle: (channel: Channel) => Promise<void>;
}) {
  const [rerunning, setRerunning] = useState(false);

  async function rerun() {
    setRerunning(true);
    try {
      await onRerun(channel);
    } finally {
      setRerunning(false);
    }
  }

  return (
    <article className={`channel-card ${channel.active ? "" : "paused"}`}>
      <div className="channel-identity">
        {channel.thumbnailUrl ? (
          <img src={channel.thumbnailUrl} alt="" />
        ) : (
          <div className="channel-fallback">
            <Youtube size={22} />
          </div>
        )}
        <div>
          <div className="channel-title-row">
            <h3>{channel.title}</h3>
            <span className={`status ${channel.active ? "active" : ""}`}>
              {channel.active ? "Active" : "Paused"}
            </span>
          </div>
          <span className="channel-id">{channel.channelId}</span>
        </div>
      </div>

      <div className="latest-video">
        <span>Latest known video</span>
        {channel.lastSeenVideo ? (
          <a
            href={channel.lastSeenVideo.url}
            target="_blank"
            rel="noreferrer"
          >
            <strong>{channel.lastSeenVideo.title}</strong>
            <small>{formatDate(channel.lastSeenVideo.publishedAt)}</small>
            <ExternalLink size={15} />
          </a>
        ) : (
          <strong>None found</strong>
        )}
      </div>

      <div className="card-actions">
        <button
          className="button secondary"
          disabled={rerunning}
          onClick={() => void rerun()}
        >
          <RefreshCw size={16} className={rerunning ? "spin" : ""} />
          {rerunning ? "Rerunning..." : "Repull + rerun"}
        </button>
        <button className="button ghost" onClick={() => void onToggle(channel)}>
          {channel.active ? "Pause" : "Resume"}
        </button>
        <button
          className="icon-button danger"
          title="Delete channel"
          onClick={() => void onDelete(channel.id)}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getError(caught: unknown) {
  return caught instanceof Error ? caught.message : "Something went wrong";
}

function sameSettings(left: GlobalSettings, right: GlobalSettings) {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.prompt === right.prompt &&
    left.telegramChatId === right.telegramChatId
  );
}

export default App;
