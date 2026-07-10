import type { AgentKindHandler } from "../../agent-kind.handler.js";

export class PrimeWorldPlaceholderHandler implements AgentKindHandler {
  readonly type = "prime-world" as const;

  create(): never {
    throw new Error("本初世界创建功能尚未实现。");
  }

  update(): never {
    throw new Error("本初世界更新功能尚未实现。");
  }
}
