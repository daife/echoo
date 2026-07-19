import type {
  AppWsServerEvent,
  Message,
  SyncBootstrap,
  SyncChange,
  SyncPage,
  BinaryWsFrameHeader,
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
} from "../contracts";

export class WebMessageRuntime implements MessageRuntime {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = false;
  private syncStatus: "stopped" | "connecting" | "syncing" | "live" = "stopped";
  private readonly pendingSyncChanges: SyncChange[] = [];
  private readonly syncChangeHandlers = new Set<(change: SyncChange) => void>();
  private readonly syncResetHandlers = new Set<() => void>();
  private readonly activeConversations = new Map<
    string,
    ConversationAgentActivityEvent
  >();
  private readonly latestActivityUpdatedAt = new Map<string, number>();
  private readonly activityExpiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly messageCreatedHandlers = new Set<
    (message: Message) => void
  >();
  private readonly messageDeltaHandlers = new Set<
    (event: MessageDeltaEvent) => void
  >();
  private readonly messageCompletedHandlers = new Set<
    (message: Message) => void
  >();
  private readonly messageUpdatedHandlers = new Set<
    (message: Message) => void
  >();
  private readonly agentActivityHandlers = new Set<
    (event: ConversationAgentActivityEvent) => void
  >();
  private readonly agentMuteChangedHandlers = new Set<
    (event: ConversationAgentMuteChangedEvent) => void
  >();
  private readonly audioStartedHandlers = new Set<
    (event: MessageAudioStartedEvent) => void
  >();
  private readonly audioChunkHandlers = new Set<
    (event: MessageAudioChunkEvent) => void
  >();
  private readonly audioCompletedHandlers = new Set<
    (event: MessageAudioCompletedEvent) => void
  >();
  private readonly audioFailedHandlers = new Set<
    (event: MessageAudioFailedEvent) => void
  >();

  constructor(private readonly auth: AuthRuntime) {}

  async startRealtime(): Promise<void> {
    this.shouldReconnect = true;
    this.syncStatus = "connecting";
    this.clearReconnectTimer();
    if (this.socket && this.socket.readyState <= WebSocket.OPEN)
      return this.connectPromise ?? Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const connectPromise = this.openSocket();
    this.connectPromise = connectPromise;
    try {
      await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  private async openSocket(): Promise<void> {
    const url = resolveWebSocketUrl(
      import.meta.env.VITE_WS_URL ?? "ws://localhost:8787/ws",
    );
    let token = await this.auth.getAccessToken();
    if (!this.shouldReconnect || !token) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    let ticketResponse = await fetch(`${apiBaseUrl()}/realtime/ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (ticketResponse.status === 401) {
      token = await this.refreshAccessToken();
      if (!token) throw new Error("登录会话已失效。");
      ticketResponse = await fetch(`${apiBaseUrl()}/realtime/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (!ticketResponse.ok) throw new Error("无法建立实时连接。");
    const { ticket } = (await ticketResponse.json()) as { ticket: string };
    const socketUrl = new URL(url);
    socketUrl.searchParams.set("ticket", ticket);

    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket) this.reconnectAttempt = 0;
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.syncStatus = "connecting";
      this.clearActiveConversations();
      this.scheduleReconnect();
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBinaryFrame(event.data);
        if (frame?.header.type === "message.audio.chunk")
          this.audioChunkHandlers.forEach((handler) =>
            handler({ ...frame.header, data: frame.data }),
          );
        return;
      }
      const payload = JSON.parse(event.data as string) as AppWsServerEvent;
      if (payload.type === "realtime.ready") {
        void this.catchUp(payload.headCursor, token).catch(() =>
          socket.close(),
        );
        return;
      }
      if (payload.type === "sync.change") {
        if (this.syncStatus !== "live")
          this.pendingSyncChanges.push(payload.change);
        else this.applySyncChange(payload.change);
        return;
      }
      if (payload.type === "conversation.agent_activity") {
        this.applyAgentActivity(payload);
        return;
      }
      if (payload.type === "conversation.agent_mute_changed") {
        this.agentMuteChangedHandlers.forEach((handler) => handler(payload));
        return;
      }
      if (payload.type === "message.created") {
        this.messageCreatedHandlers.forEach((handler) =>
          handler(payload.message),
        );
        return;
      }

      if (payload.type === "message.delta") {
        this.messageDeltaHandlers.forEach((handler) => handler(payload));
        return;
      }

      if (payload.type === "message.completed") {
        this.messageCompletedHandlers.forEach((handler) =>
          handler(payload.message),
        );
        return;
      }
      if (payload.type === "message.updated") {
        this.messageUpdatedHandlers.forEach((handler) =>
          handler(payload.message),
        );
        return;
      }
      if (payload.type === "message.audio.started")
        this.audioStartedHandlers.forEach((handler) => handler(payload));
      else if (payload.type === "message.audio.completed")
        this.audioCompletedHandlers.forEach((handler) => handler(payload));
      else if (payload.type === "message.audio.failed")
        this.audioFailedHandlers.forEach((handler) => handler(payload));
    };
  }

  async stopRealtime(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearActiveConversations();
    this.socket?.close(1000, "client stop");
    this.socket = null;
    this.syncStatus = "stopped";
    this.pendingSyncChanges.length = 0;
  }

  getSyncStatus() {
    return this.syncStatus;
  }

  async getSyncCursor() {
    const token = await this.auth.getAccessToken();
    return token ? Number(localStorage.getItem(syncCursorKey(token)) ?? 0) : 0;
  }

  async setSyncCursor(cursor: number) {
    const token = await this.auth.getAccessToken();
    if (token && Number.isSafeInteger(cursor) && cursor >= 0)
      localStorage.setItem(syncCursorKey(token), String(cursor));
  }

  onSyncChange(handler: (change: SyncChange) => void) {
    this.syncChangeHandlers.add(handler);
    return () => this.syncChangeHandlers.delete(handler);
  }

  onSyncReset(handler: () => void) {
    this.syncResetHandlers.add(handler);
    return () => this.syncResetHandlers.delete(handler);
  }

  private async catchUp(headCursor: number, token: string) {
    this.syncStatus = "syncing";
    let cursor = Number(localStorage.getItem(syncCursorKey(token)) ?? 0);
    for (;;) {
      const response = await fetch(
        `${apiBaseUrl()}/sync?after=${cursor}&limit=500`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error("增量同步失败。");
      const page = (await response.json()) as SyncPage;
      if (page.resetRequired) {
        this.syncResetHandlers.forEach((handler) => handler());
        const bootstrapResponse = await fetch(
          `${apiBaseUrl()}/sync/bootstrap`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!bootstrapResponse.ok) throw new Error("同步快照失败。");
        const bootstrap = (await bootstrapResponse.json()) as SyncBootstrap;
        const now = Date.now();
        bootstrap.agents.forEach((value) =>
          this.applySyncChange({
            cursor: bootstrap.cursor,
            entityType: "agent",
            entityId: value.id,
            conversationId: value.conversationId,
            operation: "upsert",
            entity: { entityType: "agent", value },
            createdAt: now,
          }),
        );
        bootstrap.assets.forEach((value) =>
          this.applySyncChange({
            cursor: bootstrap.cursor,
            entityType: "asset",
            entityId: value.id,
            operation: "upsert",
            entity: { entityType: "asset", value },
            createdAt: now,
          }),
        );
        cursor = bootstrap.cursor;
        break;
      }
      page.changes.forEach((change) => this.applySyncChange(change));
      cursor = page.cursor;
      if (!page.hasMore && cursor >= headCursor) break;
      if (!page.hasMore && page.headCursor <= cursor) break;
    }
    this.pendingSyncChanges
      .splice(0)
      .sort((left, right) => left.cursor - right.cursor)
      .forEach((change) => {
        if (change.cursor > cursor) this.applySyncChange(change);
      });
    this.syncStatus = "live";
  }

  private applySyncChange(change: SyncChange) {
    const tokenPromise = this.auth.getAccessToken();
    void tokenPromise.then((token) => {
      if (token) {
        const key = syncCursorKey(token);
        const current = Number(localStorage.getItem(key) ?? 0);
        if (change.cursor > current)
          localStorage.setItem(key, String(change.cursor));
      }
    });
    this.syncChangeHandlers.forEach((handler) => handler(change));
  }

  private async refreshAccessToken() {
    const refreshToken = await this.auth.getRefreshToken();
    if (!refreshToken) return null;
    const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      await this.auth.clearTokens();
      return null;
    }
    const session =
      (await response.json()) as import("@echoo/shared").AuthSession;
    await this.auth.saveTokens(session.tokens);
    return session.tokens.accessToken;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer !== null || this.socket)
      return;
    const delay = Math.min(500 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.startRealtime().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearActiveConversations() {
    const updatedAt = Date.now();
    for (const timer of this.activityExpiryTimers.values()) clearTimeout(timer);
    this.activityExpiryTimers.clear();
    for (const event of this.activeConversations.values()) {
      const inactiveEvent: ConversationAgentActivityEvent = {
        ...event,
        active: false,
        updatedAt,
      };
      this.agentActivityHandlers.forEach((handler) => handler(inactiveEvent));
    }
    this.activeConversations.clear();
    this.latestActivityUpdatedAt.clear();
  }

  private applyAgentActivity(event: ConversationAgentActivityEvent) {
    const latestUpdatedAt =
      this.latestActivityUpdatedAt.get(event.conversationId) ?? -Infinity;
    if (event.updatedAt < latestUpdatedAt) return;

    this.latestActivityUpdatedAt.set(event.conversationId, event.updatedAt);
    const currentTimer = this.activityExpiryTimers.get(event.conversationId);
    if (currentTimer) clearTimeout(currentTimer);
    this.activityExpiryTimers.delete(event.conversationId);

    if (!event.active) {
      this.activeConversations.delete(event.conversationId);
      this.agentActivityHandlers.forEach((handler) => handler(event));
      return;
    }

    if (event.expiresAt !== undefined && event.expiresAt <= Date.now()) {
      this.expireAgentActivity(event);
      return;
    }

    this.activeConversations.set(event.conversationId, event);
    this.agentActivityHandlers.forEach((handler) => handler(event));
    if (event.expiresAt === undefined) return;

    const timer = setTimeout(
      () => this.expireAgentActivity(event),
      Math.max(0, event.expiresAt - Date.now()),
    );
    this.activityExpiryTimers.set(event.conversationId, timer);
  }

  private expireAgentActivity(event: ConversationAgentActivityEvent) {
    const current = this.activeConversations.get(event.conversationId);
    if (current && current.updatedAt > event.updatedAt) return;
    this.activityExpiryTimers.delete(event.conversationId);
    this.activeConversations.delete(event.conversationId);
    const updatedAt = event.expiresAt ?? Date.now();
    const inactiveEvent: ConversationAgentActivityEvent = {
      ...event,
      active: false,
      updatedAt,
      expiresAt: undefined,
    };
    this.agentActivityHandlers.forEach((handler) => handler(inactiveEvent));
  }

  async getStatus(): Promise<"running" | "stopped" | "unsupported"> {
    return this.socket?.readyState === WebSocket.OPEN ? "running" : "stopped";
  }

  onMessageCreated(handler: (message: Message) => void): () => void {
    this.messageCreatedHandlers.add(handler);
    return () => this.messageCreatedHandlers.delete(handler);
  }

  onMessageDelta(handler: (event: MessageDeltaEvent) => void): () => void {
    this.messageDeltaHandlers.add(handler);
    return () => this.messageDeltaHandlers.delete(handler);
  }

  onMessageCompleted(handler: (message: Message) => void): () => void {
    this.messageCompletedHandlers.add(handler);
    return () => this.messageCompletedHandlers.delete(handler);
  }

  onMessageUpdated(handler: (message: Message) => void): () => void {
    this.messageUpdatedHandlers.add(handler);
    return () => this.messageUpdatedHandlers.delete(handler);
  }

  onConversationAgentActivity(
    handler: (event: ConversationAgentActivityEvent) => void,
  ): () => void {
    this.agentActivityHandlers.add(handler);
    this.activeConversations.forEach(handler);
    return () => this.agentActivityHandlers.delete(handler);
  }

  onConversationAgentMuteChanged(
    handler: (event: ConversationAgentMuteChangedEvent) => void,
  ): () => void {
    this.agentMuteChangedHandlers.add(handler);
    return () => this.agentMuteChangedHandlers.delete(handler);
  }

  onMessageAudioStarted(
    handler: (event: MessageAudioStartedEvent) => void,
  ): () => void {
    this.audioStartedHandlers.add(handler);
    return () => this.audioStartedHandlers.delete(handler);
  }

  onMessageAudioChunk(
    handler: (event: MessageAudioChunkEvent) => void,
  ): () => void {
    this.audioChunkHandlers.add(handler);
    return () => this.audioChunkHandlers.delete(handler);
  }

  onMessageAudioCompleted(
    handler: (event: MessageAudioCompletedEvent) => void,
  ): () => void {
    this.audioCompletedHandlers.add(handler);
    return () => this.audioCompletedHandlers.delete(handler);
  }

  onMessageAudioFailed(
    handler: (event: MessageAudioFailedEvent) => void,
  ): () => void {
    this.audioFailedHandlers.add(handler);
    return () => this.audioFailedHandlers.delete(handler);
  }
}

export function decodeBinaryFrame(value: ArrayBuffer) {
  if (value.byteLength < 4) return null;
  const view = new DataView(value);
  const headerLength = view.getUint32(0);
  if (headerLength <= 0 || headerLength > value.byteLength - 4) return null;
  try {
    const header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(value, 4, headerLength)),
    ) as BinaryWsFrameHeader;
    return {
      header,
      data: new Uint8Array(value, 4 + headerLength),
    };
  } catch {
    return null;
  }
}

export function resolveWebSocketUrl(
  configuredUrl: string,
  pageUrl = window.location.href,
) {
  const url = new URL(configuredUrl, pageUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new Error("VITE_WS_URL 必须使用 ws、wss、http、https 或相对路径。");
  return url.toString();
}

function apiBaseUrl() {
  return (
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api"
  ).replace(/\/+$/, "");
}

function syncCursorKey(token: string) {
  const payload = token.split(".")[1];
  try {
    const user = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as {
      sub?: string;
    };
    return `sync.cursor.v2:${user.sub ?? "unknown"}`;
  } catch {
    return "sync.cursor.v2:unknown";
  }
}
