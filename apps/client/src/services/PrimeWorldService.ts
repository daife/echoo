import type { PrimeWorldApi, ResourcesApi } from "@echoo/api-client";
import type {
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldExportBundle,
  PrimeWorldRealtimeEvent,
  WorldView,
} from "@echoo/shared";
import type {
  MessageRuntime,
  PrimeWorldAudioChunkEvent,
} from "../runtimes/contracts";
import { mediaCache } from "./mediaCache";
import { primeWorldLocalCache } from "./primeWorldLocalCache";

export class PrimeWorldService {
  private userId?: string;

  constructor(
    private readonly api: PrimeWorldApi,
    private readonly resources?: ResourcesApi,
    private readonly realtime?: MessageRuntime,
  ) {}

  configureSession(userId?: string) {
    this.userId = userId;
  }

  async getSnapshot(conversationId: string, allowCached = true) {
    try {
      const snapshot = await this.api.getSnapshot(conversationId);
      if (this.userId)
        void primeWorldLocalCache.putSnapshot(
          this.userId,
          conversationId,
          snapshot,
        );
      return { ...snapshot, cached: false as const };
    } catch (error) {
      const cached =
        allowCached && this.userId
          ? await primeWorldLocalCache.getSnapshot(this.userId, conversationId)
          : null;
      if (cached)
        return {
          ...(cached.run?.status === "queued" ||
          cached.run?.status === "running"
            ? { ...cached, run: undefined }
            : cached),
          cached: true as const,
        };
      throw error;
    }
  }
  async dispatch(conversationId: string, event: PrimeWorldEventInput) {
    return (await this.api.dispatch(conversationId, event)).run;
  }
  validate(detail: PrimeWorldDetail) {
    return this.api.validate(detail);
  }
  cancel(conversationId: string, runId: string) {
    return this.api.cancel(conversationId, runId);
  }
  catalog() {
    return this.api.getCatalog();
  }
  trace(conversationId: string, runId: string) {
    return this.api.getTrace(conversationId, runId);
  }
  reset(conversationId: string) {
    return this.api.reset(conversationId);
  }
  exportBundle(conversationId: string) {
    return this.api.exportBundle(conversationId);
  }
  importBundle(bundle: PrimeWorldExportBundle) {
    return this.api.importBundle(bundle);
  }
  subscribe(
    onEvent: (event: PrimeWorldRealtimeEvent) => void,
    onAudio: (event: PrimeWorldAudioChunkEvent) => void,
  ) {
    const offEvent =
      this.realtime?.onPrimeWorldEvent(onEvent) ?? (() => undefined);
    const offAudio =
      this.realtime?.onPrimeWorldAudioChunk(onAudio) ?? (() => undefined);
    return () => {
      offEvent();
      offAudio();
    };
  }
  subscribeStatus(
    onStatus: (status: "stopped" | "connecting" | "syncing" | "live") => void,
  ) {
    return this.realtime?.onSyncStatusChange(onStatus) ?? (() => undefined);
  }
  getRealtimeStatus() {
    return this.realtime?.getSyncStatus() ?? "stopped";
  }
  async uploadVoice(blob: Blob) {
    if (!this.resources) throw new Error("资源上传服务不可用。");
    if (blob.size > 12 * 1024 * 1024)
      throw new Error("录音文件不能超过 12 MiB。");
    const ticket = await this.resources.createUpload({
      kind: "end_user_voice",
      fileName: `world-voice-${Date.now()}.mp3`,
      mimeType: "audio/mpeg",
      byteSize: blob.size,
    });
    await this.resources.upload(ticket, blob);
    await this.resources.complete(ticket.resourceId);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await this.resources.status(ticket.resourceId);
      if (status.status === "ready") return ticket.resourceId;
      if (status.status === "failed") throw new Error("录音资源处理失败。");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("录音资源处理超时。");
  }
  async resolveViewResources(view: WorldView) {
    const ids = new Set<string>();
    if (view.background?.resourceId) ids.add(view.background.resourceId);
    const visit = (element: WorldView["root"]) => {
      if (element.type === "image") ids.add(element.resourceId);
      if (element.type === "stack") element.children.forEach(visit);
    };
    visit(view.root);
    const entries = await Promise.all(
      [...ids].map(async (resourceId) => {
        const blob = await mediaCache.getByResourceId(resourceId, "display");
        return blob ? ([resourceId, URL.createObjectURL(blob)] as const) : null;
      }),
    );
    return new Map(
      entries.filter((entry): entry is readonly [string, string] =>
        Boolean(entry),
      ),
    );
  }
  async resolveAudioResource(resourceId: string) {
    const blob = await mediaCache.getByResourceId(resourceId, "original");
    return blob ? URL.createObjectURL(blob) : undefined;
  }

  cacheAudioResource(resourceId: string, blob: Blob) {
    return mediaCache.putByResourceId(resourceId, blob, "original");
  }

  cacheCommittedView(
    conversationId: string,
    view: WorldView,
    stateVersion: number,
  ) {
    if (!this.userId) return Promise.resolve();
    return primeWorldLocalCache.updateSnapshotView(
      this.userId,
      conversationId,
      view,
      stateVersion,
    );
  }
}
