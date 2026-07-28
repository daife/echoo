import type { RuntimeConfigWarning } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import { runtimeConfigNotice } from "./runtimeConfigNotice";

function warning(
  code: RuntimeConfigWarning["code"],
  message: string,
): RuntimeConfigWarning {
  return { path: "sliceFigure.llm", code, message };
}

describe("runtime config notice", () => {
  it("hides stale catalog metadata warnings", () => {
    expect(
      runtimeConfigNotice("配置已保存。", [
        warning("MODEL_METADATA_STALE", "模型元数据已超过 24 小时未同步。"),
      ]),
    ).toBe("配置已保存。");
  });

  it("keeps warnings that are relevant to the selected model", () => {
    expect(
      runtimeConfigNotice("配置已保存。", [
        warning("MODEL_METADATA_STALE", "模型元数据已超过 24 小时未同步。"),
        warning("MODEL_NOT_IN_CATALOG", "该模型不在当前平台目录中。"),
      ]),
    ).toBe("配置已保存。 提示：该模型不在当前平台目录中。");
  });
});
