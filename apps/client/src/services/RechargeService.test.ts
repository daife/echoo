import { afterEach, describe, expect, it, vi } from "vitest";
import { submitPostForm } from "./RechargeService";
import {
  calculatePreviewMoneyCny,
  rechargeUnavailableMessage,
} from "../pages/settings/RechargePanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recharge checkout form", () => {
  it("previews the same integer, half-up RMB conversion as the server", () => {
    expect(calculatePreviewMoneyCny("10", "7.234567")).toBe("72.35");
    expect(calculatePreviewMoneyCny("1", "0.01")).toBe("0.01");
    expect(calculatePreviewMoneyCny("1.001", "7.2")).toBeNull();
  });

  it("explains which recharge prerequisite is missing", () => {
    expect(
      rechargeUnavailableMessage({
        enabled: false,
        paymentConfigured: false,
        usdToCnyRate: "7.2",
        minimumCreditUsd: "1",
        maximumCreditUsd: "1000",
        quickAmountsUsd: ["5", "10", "20", "50", "100"],
        paymentTypes: ["alipay", "wxpay"],
      }),
    ).toContain("已设置汇率，但在线充值尚未配置商户");
  });

  it("posts every server-signed field without changing it", () => {
    const children: Array<{ name: string; value: string; type: string }> = [];
    const submit = vi.fn();
    const remove = vi.fn();
    const form = {
      method: "",
      action: "",
      style: { display: "" },
      appendChild: (child: { name: string; value: string; type: string }) =>
        children.push(child),
      submit,
      remove,
    };
    const documentStub = {
      createElement: (tag: string) =>
        tag === "form" ? form : { type: "", name: "", value: "" },
      body: { appendChild: vi.fn() },
    };
    vi.stubGlobal("document", documentStub);

    submitPostForm("https://zpayz.cn/submit.php", {
      name: "Echoo 充值",
      money: "72.00",
      sign: "signed-value",
    });

    expect(form.method).toBe("POST");
    expect(form.action).toBe("https://zpayz.cn/submit.php");
    expect(children).toEqual([
      { type: "hidden", name: "name", value: "Echoo 充值" },
      { type: "hidden", name: "money", value: "72.00" },
      { type: "hidden", name: "sign", value: "signed-value" },
    ]);
    expect(documentStub.body.appendChild).toHaveBeenCalledWith(form);
    expect(submit).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});
