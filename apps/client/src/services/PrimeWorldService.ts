import type { PrimeWorldApi, ResourcesApi } from "@echoo/api-client";
import type {
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldExportBundle,
  PrimeWorldRun,
  PrimeWorldRealtimeEvent,
  WorldView,
} from "@echoo/shared";
import type { MessageRuntime, PrimeWorldAudioChunkEvent } from "../runtimes/contracts";

export class PrimeWorldService {
  constructor(
    private readonly api: PrimeWorldApi,
    private readonly resources?: ResourcesApi,
    private readonly realtime?: MessageRuntime,
  ) {}
  getSnapshot(conversationId: string) {
    return this.api.getSnapshot(conversationId);
  }
  async dispatch(conversationId: string, event: PrimeWorldEventInput) {
    const { run } = await this.api.dispatch(conversationId, event);
    return this.waitForRun(conversationId, run);
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
    const offEvent = this.realtime?.onPrimeWorldEvent(onEvent) ?? (() => undefined);
    const offAudio = this.realtime?.onPrimeWorldAudioChunk(onAudio) ?? (() => undefined);
    return () => { offEvent(); offAudio(); };
  }
  async uploadVoice(blob: Blob) {
    if (!this.resources) throw new Error("资源上传服务不可用。");
    if (blob.size > 12 * 1024 * 1024) throw new Error("录音文件不能超过 12 MiB。");
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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("录音资源处理超时。");
  }
  async resolveViewResources(view: WorldView) {
    if (!this.resources) return new Map<string, string>();
    const ids = new Set<string>();
    if (view.background?.resourceId) ids.add(view.background.resourceId);
    const visit = (element: WorldView["root"]) => {
      if (element.type === "image") ids.add(element.resourceId);
      if (element.type === "stack") element.children.forEach(visit);
    };
    visit(view.root);
    const items = await this.resources.access([...ids].map((resourceId) => ({ resourceId, variant: "display" as const })));
    return new Map(items.map((item) => [item.resourceId, item.url]));
  }
  async resolveAudioResource(resourceId: string) {
    const [item] = (await this.resources?.access([{ resourceId, variant: "original" }])) ?? [];
    return item?.url;
  }

  private async waitForRun(conversationId: string, initial: PrimeWorldRun) {
    let run = initial;
    const deadline = Date.now() + 30_000;
    while (run.status === "queued" || run.status === "running") {
      if (Date.now() >= deadline)
        throw new Error("世界仍在后台运行，请稍后重试。");
      await new Promise((resolve) => setTimeout(resolve, 180));
      run = (await this.api.getRun(conversationId, run.id)).run;
    }
    if (run.status === "failed")
      throw new Error(run.errorDetail || "世界运行失败。");
    if (run.status === "cancelled") throw new Error("世界运行已取消。");
    return run;
  }
}
