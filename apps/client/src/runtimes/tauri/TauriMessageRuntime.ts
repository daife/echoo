import type {
  Message,
  PrimeWorldRealtimeEvent,
  SyncChange,
} from "@echoo/shared";
import type {
  AuthRuntime,
  ConversationAgentActivityEvent,
  ConversationAgentMuteChangedEvent,
  MessageAudioChunkEvent,
  MessageAudioCompletedEvent,
  MessageAudioFailedEvent,
  MessageAudioStartedEvent,
  MessageDeltaEvent,
  MessageRuntime,
  PrimeWorldAudioChunkEvent,
} from "../contracts";
import { WebMessageRuntime } from "../web/WebMessageRuntime";
import { tauriInvoke } from "./tauriInvoke";

export class TauriMessageRuntime implements MessageRuntime {
  private readonly realtime: WebMessageRuntime;
  private started = false;
  private backgroundNotificationsEnabled = false;
  private handoff: Promise<void> = Promise.resolve();
  private readonly handleVisibilityChange = () => this.queueHandoff();

  constructor(private readonly auth: AuthRuntime) {
    this.realtime = new WebMessageRuntime(auth);
  }

  async startRealtime(): Promise<void> {
    if (this.started) return this.handoff;
    this.started = true;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    await this.queueHandoff();
  }

  async stopRealtime(): Promise<void> {
    this.started = false;
    this.backgroundNotificationsEnabled = false;
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    await this.handoff;
    await this.realtime.stopRealtime();
    await tauriInvoke("plugin:keepalive|stop").catch(reportKeepAliveError);
  }

  async setBackgroundNotificationsEnabled(enabled: boolean): Promise<void> {
    if (!isAndroid()) return;
    this.backgroundNotificationsEnabled = enabled;
    if (!enabled) {
      await tauriInvoke("plugin:keepalive|stop").catch(reportKeepAliveError);
      return;
    }
    if (this.started && !document.hidden) await this.queueHandoff();
  }

  async getStatus(): Promise<"running" | "stopped" | "unsupported"> {
    return tauriInvoke<"running" | "stopped" | "unsupported">(
      "plugin:keepalive|status",
    ).catch(() => "unsupported");
  }

  getSyncStatus() {
    return this.realtime.getSyncStatus();
  }

  onSyncStatusChange(
    handler: (status: "stopped" | "connecting" | "syncing" | "live") => void,
  ) {
    return this.realtime.onSyncStatusChange(handler);
  }

  getSyncCursor() {
    return this.realtime.getSyncCursor();
  }

  private queueHandoff() {
    this.handoff = this.handoff
      .catch(reportKeepAliveError)
      .then(() => this.applyConnectionOwner())
      .catch(reportKeepAliveError);
    return this.handoff;
  }

  private async applyConnectionOwner() {
    if (!this.started) return;
    if (!isAndroid()) {
      await tauriInvoke("plugin:keepalive|stop").catch(() => undefined);
      await this.realtime.startRealtime();
      return;
    }

    if (document.hidden) {
      await this.realtime.stopRealtime();
      if (this.backgroundNotificationsEnabled)
        await this.updateNativeConnection(false, true);
      return;
    }

    const state = await tauriInvoke<NativeHandoff>(
      "plugin:keepalive|handoff",
    ).catch((error) => {
      reportKeepAliveError(error);
      return null;
    });
    if (state?.accessToken && state.refreshToken) {
      await this.auth.saveTokens({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
      });
      await this.realtime.setSyncCursor(state.cursor);
    }
    await this.realtime.startRealtime();
    if (this.backgroundNotificationsEnabled) {
      await this.updateNativeConnection(true, false);
    } else {
      await this.updateNativeConnection(true, false, true);
    }
  }

  private async updateNativeConnection(
    ensureService: boolean,
    activateSocket: boolean,
    resumeOnly = false,
  ) {
    const [accessToken, refreshToken, cursor] = await Promise.all([
      this.auth.getAccessToken(),
      this.auth.getRefreshToken(),
      this.realtime.getSyncCursor(),
    ]);
    if (!accessToken || !refreshToken) return;
    await tauriInvoke("plugin:keepalive|start", {
      accessToken,
      refreshToken,
      expiresAt: tokenExpiresAt(accessToken),
      cursor,
      wsUrl: import.meta.env.VITE_WS_URL ?? "ws://localhost:8787/ws",
      apiBaseUrl:
        import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api",
      ensureService,
      activateSocket,
      resumeOnly,
    });
  }

  onSyncChange(handler: (change: SyncChange) => void) {
    return this.realtime.onSyncChange(handler);
  }

  onSyncReset(handler: () => void) {
    return this.realtime.onSyncReset(handler);
  }

  onMessageCreated(_handler: (message: Message) => void): () => void {
    return this.realtime.onMessageCreated(_handler);
  }

  onMessageDelta(_handler: (event: MessageDeltaEvent) => void): () => void {
    return this.realtime.onMessageDelta(_handler);
  }

  onMessageCompleted(_handler: (message: Message) => void): () => void {
    return this.realtime.onMessageCompleted(_handler);
  }

  onMessageUpdated(_handler: (message: Message) => void): () => void {
    return this.realtime.onMessageUpdated(_handler);
  }

  onConversationAgentActivity(
    _handler: (event: ConversationAgentActivityEvent) => void,
  ): () => void {
    return this.realtime.onConversationAgentActivity(_handler);
  }

  onConversationAgentMuteChanged(
    _handler: (event: ConversationAgentMuteChangedEvent) => void,
  ): () => void {
    return this.realtime.onConversationAgentMuteChanged(_handler);
  }

  onMessageAudioStarted(
    _handler: (event: MessageAudioStartedEvent) => void,
  ): () => void {
    return this.realtime.onMessageAudioStarted(_handler);
  }

  onMessageAudioChunk(
    _handler: (event: MessageAudioChunkEvent) => void,
  ): () => void {
    return this.realtime.onMessageAudioChunk(_handler);
  }

  onMessageAudioCompleted(
    _handler: (event: MessageAudioCompletedEvent) => void,
  ): () => void {
    return this.realtime.onMessageAudioCompleted(_handler);
  }

  onMessageAudioFailed(
    _handler: (event: MessageAudioFailedEvent) => void,
  ): () => void {
    return this.realtime.onMessageAudioFailed(_handler);
  }

  onPrimeWorldEvent(_handler: (event: PrimeWorldRealtimeEvent) => void) {
    return this.realtime.onPrimeWorldEvent(_handler);
  }

  onPrimeWorldAudioChunk(_handler: (event: PrimeWorldAudioChunkEvent) => void) {
    return this.realtime.onPrimeWorldAudioChunk(_handler);
  }
}

interface NativeHandoff {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  cursor: number;
}

function tokenExpiresAt(token: string) {
  try {
    const encoded = (token.split(".")[1] ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const payload = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
    ) as {
      exp?: number;
    };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function reportKeepAliveError(error: unknown) {
  console.error("Android keep-alive operation failed", error);
}
