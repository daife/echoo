import type { ExternalInterfaceType } from "@echoo/shared";
import type { Connector } from "./connector.interface.js";

export class ConnectorRegistry {
  private readonly connectors = new Map<ExternalInterfaceType, Connector>();

  register(connector: Connector) {
    this.connectors.set(connector.type, connector);
  }

  get(type: ExternalInterfaceType) {
    return this.connectors.get(type);
  }
}
