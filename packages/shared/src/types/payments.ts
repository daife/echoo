export type RechargePaymentType = "alipay" | "wxpay";

export type RechargeOrderStatus = "pending" | "paid";

export interface RechargeConfigView {
  enabled: boolean;
  /** Whether the server has a complete payment-provider configuration. */
  paymentConfigured: boolean;
  usdToCnyRate: string | null;
  minimumCreditUsd: "0.1";
  maximumCreditUsd: "1000";
  quickAmountsUsd: ["5", "10", "20", "50", "100"];
  paymentTypes: RechargePaymentType[];
}

export interface RechargeOrderView {
  outTradeNo: string;
  status: RechargeOrderStatus;
  paymentType: RechargePaymentType;
  creditUsd: string;
  usdToCnyRate: string;
  moneyCny: string;
  createdAt: number;
  paidAt?: number;
}

export interface CreateRechargeOrderRequest {
  creditUsd: string;
  paymentType: RechargePaymentType;
}

export interface RechargeCheckoutView {
  order: RechargeOrderView;
  externalCheckoutUrl: string;
  form: {
    actionUrl: string;
    method: "POST";
    fields: Record<string, string>;
  };
}
