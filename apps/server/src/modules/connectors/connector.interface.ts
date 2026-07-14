import type {
  ExternalInterfaceCapability,
  ExternalInterfaceType,
  Message,
} from "@echoo/shared";

export interface Connector {
  type: ExternalInterfaceType;
  capability: ExternalInterfaceCapability;
  sendMessage(message: Message): Promise<{ externalMessageId?: string }>;
}
