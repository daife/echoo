export type ExternalInterfaceType = "telegram" | "qq" | "wechat";

export interface ExternalInterfaceBinding {
  id: string;
  ownerUserId: string;
  interfaceType: ExternalInterfaceType;
  boundConversationId?: string;
  boundAgentId?: string;
  displayName: string;
  externalAccountId?: string;
  enabled: boolean;
  createdAt: number;
}

export interface ExternalInterfaceCapability {
  canReceiveMessage: boolean;
  canSendMessage: boolean;
  canSendImage: boolean;
  canSendFile: boolean;
  canRecallMessage: boolean;
  supportsReadReceipt: boolean;
  supportsDeliveryReceipt: boolean;
  requiresReplyWindow: boolean;
}
