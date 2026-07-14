import type { Message } from "@echoo/shared";
import { createId } from "../../../../shared/utils/id.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { AppPushService } from "../../../realtime/delivery.service.js";
import type { PrimeDecisionTrigger } from "./prime-figure-runtime.service.js";

export class PrimeRuntimeFailureNotifier {
  constructor(
    private readonly messages = new MessageRepository(),
    private readonly appPush = new AppPushService(),
  ) {}

  async notify(input: {
    ownerUserId: string;
    conversationId: string;
    trigger: PrimeDecisionTrigger;
    errorMessage: string;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    try {
      const message: Message = await this.messages.save({
        ownerUserId: input.ownerUserId,
        id: createId("msg"),
        conversationId: input.conversationId,
        role: "system",
        contentType: "system",
        content: { text: input.errorMessage },
        status: "delivered",
        metadata: {
          kind: "prime_runtime_error",
          actionType: "prime_runtime",
          trigger: input.trigger,
        },
        createdAt: now,
        updatedAt: now,
      });
      this.appPush.pushToUser(input.ownerUserId, {
        type: "message.created",
        message,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "prime_runtime_failure_notification",
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          status: "failed",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Failed to publish Prime runtime failure notification.",
          at: now,
        }),
      );
    }
  }
}
