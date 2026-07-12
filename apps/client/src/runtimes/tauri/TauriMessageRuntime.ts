import type { Message } from "@echoo/shared";
import type {
  AuthRuntime,
  ConversationAgentActivityEvent,
  MessageAudioChunkEvent,
  MessageAudioCompletedEvent,
  MessageAudioFailedEvent,
  MessageAudioStartedEvent,
  MessageDeltaEvent,
  MessageRuntime,
} from "../contracts";
import { WebMessageRuntime } from "../web/WebMessageRuntime";
import { tauriInvoke } from "./tauriInvoke";

export class TauriMessageRuntime implements MessageRuntime {
  private readonly realtime: WebMessageRuntime;

  constructor(auth: AuthRuntime) {
    this.realtime = new WebMessageRuntime(auth);
  }

  async startRealtime(): Promise<void> {
    await Promise.all([
      tauriInvoke("plugin:keepalive|start").catch(() => undefined),
      this.realtime.startRealtime(),
    ]);
  }

  async stopRealtime(): Promise<void> {
    await Promise.all([
      tauriInvoke("plugin:keepalive|stop").catch(() => undefined),
      this.realtime.stopRealtime(),
    ]);
  }

  async getStatus(): Promise<"running" | "stopped" | "unsupported"> {
    return tauriInvoke<"running" | "stopped" | "unsupported">(
      "plugin:keepalive|status",
    ).catch(() => "unsupported");
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

  onConversationAgentActivity(
    _handler: (event: ConversationAgentActivityEvent) => void,
  ): () => void {
    return this.realtime.onConversationAgentActivity(_handler);
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
}
