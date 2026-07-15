import { AsyncLocalStorage } from "node:async_hooks";

export interface BillingRunContext {
  ownerUserId: string;
  conversationId?: string;
}

const storage = new AsyncLocalStorage<BillingRunContext>();

export const BillingContext = {
  run<T>(context: BillingRunContext, callback: () => T): T {
    return storage.run(context, callback);
  },
  current() {
    return storage.getStore();
  },
};
