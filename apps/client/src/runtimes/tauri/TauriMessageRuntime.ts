import type { Message, PrimeWorldRealtimeEvent, SyncChange } from "@echoo/shared";
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
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    await this.handoff;
    await this.realtime.stopRealtime();
    await tauriInvoke("plugin:keepalive|stop").catch(() => undefined);
  }

  async getStatus(): Promise<"running" | "stopped" | "unsupported"> {
    return tauriInvoke<"running" | "stopped" | "unsupported">(
      "plugin:keepalive|status",
    ).catch(() => "unsupported");
  }

  getSyncStatus() {
    return this.realtime.getSyncStatus();
  }

  getSyncCursor() {
    return this.realtime.getSyncCursor();
  }

  private queueHandoff() {
    this.handoff = this.handoff.then(() => this.applyConnectionOwner());
    return this.handoff;
  }

  private async applyConnectionOwner() {
    if (!this.started) return;
    const useNative = /Android/i.test(navigator.userAgent) && document.hidden;
    if (!useNative) {
      if (/Android/i.test(navigator.userAgent)) {
        const state = await tauriInvoke<NativeHandoff>(
          "plugin:keepalive|handoff",
        ).catch(() => null);
        if (state?.accessToken && state.refreshToken) {
          await this.auth.saveTokens({
            accessToken: state.accessToken,
            refreshToken: state.refreshToken,
            expiresAt: state.expiresAt,
          });
          await this.realtime.setSyncCursor(state.cursor);
        }
      } else {
        await tauriInvoke("plugin:keepalive|stop").catch(() => undefined);
      }
      await this.realtime.startRealtime();
      return;
    }

    const [accessToken, refreshToken, cursor] = await Promise.all([
      this.auth.getAccessToken(),
      this.auth.getRefreshToken(),
      this.realtime.getSyncCursor(),
    ]);
    await this.realtime.stopRealtime();
    if (!accessToken || !refreshToken) return;
    await tauriInvoke("plugin:keepalive|start", {
      accessToken,
      refreshToken,
      expiresAt: tokenExpiresAt(accessToken),
      cursor,
      wsUrl: import.meta.env.VITE_WS_URL ?? "ws://localhost:8787/ws",
      apiBaseUrl:
        import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api",
    }).catch(() => undefined);
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
    const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}
