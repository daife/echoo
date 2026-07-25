import type { PaymentsApi } from "@echoo/api-client";
import type { CreateRechargeOrderRequest, RechargeCheckoutView } from "@echoo/shared";
import { isTauri } from "../runtimes/factory/detectPlatform";

export class RechargeService {
  constructor(private readonly api: PaymentsApi) {}

  getConfig() {
    return this.api.getRechargeConfig();
  }

  createOrder(input: CreateRechargeOrderRequest) {
    return this.api.createRechargeOrder(input);
  }

  getOrder(outTradeNo: string) {
    return this.api.getRechargeOrder(outTradeNo);
  }

  reconcile(outTradeNo: string) {
    return this.api.reconcileRechargeOrder(outTradeNo);
  }

  async submitCheckout(checkout: RechargeCheckoutView) {
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(checkout.externalCheckoutUrl);
      return "external" as const;
    }
    submitPostForm(checkout.form.actionUrl, checkout.form.fields);
    return "web" as const;
  }
}

export function submitPostForm(
  actionUrl: string,
  fields: Record<string, string>,
) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
