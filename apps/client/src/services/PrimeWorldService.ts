import type { PrimeWorldApi } from "@echoo/api-client";
import type {
  PrimeWorldDetail,
  PrimeWorldEventInput,
  PrimeWorldRun,
} from "@echoo/shared";

export class PrimeWorldService {
  constructor(private readonly api: PrimeWorldApi) {}
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
