import type { Message } from "@echoo/shared";
import type { ExternalInterfaceType } from "@echoo/shared";
import { ConnectorRegistry } from "./connector.registry.js";

export class ConnectorRouter {
  constructor(private readonly registry: ConnectorRegistry) {}

  async route(message: Message, interfaceType: ExternalInterfaceType) {
    const connector = this.registry.get(interfaceType);
    if (!connector) throw new Error(`Connector not registered: ${interfaceType}`);
    return connector.sendMessage(message);
  }
}
