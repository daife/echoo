import type {
  CreateRechargeOrderRequest,
  RechargeCheckoutView,
  RechargeConfigView,
  RechargeOrderView,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class PaymentsApi {
  constructor(private readonly client: ApiClient) {}

  getRechargeConfig(): Promise<RechargeConfigView> {
    return this.client.get("/users/me/recharge-config");
  }

  createRechargeOrder(
    body: CreateRechargeOrderRequest,
  ): Promise<RechargeCheckoutView> {
    return this.client.post("/users/me/recharge-orders", body);
  }

  getRechargeOrder(outTradeNo: string): Promise<RechargeOrderView> {
    return this.client.get(
      `/users/me/recharge-orders/${encodeURIComponent(outTradeNo)}`,
    );
  }

  reconcileRechargeOrder(outTradeNo: string): Promise<RechargeOrderView> {
    return this.client.post(
      `/users/me/recharge-orders/${encodeURIComponent(outTradeNo)}/reconcile`,
    );
  }
}

