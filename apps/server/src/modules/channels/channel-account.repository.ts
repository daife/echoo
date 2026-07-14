import type { ExternalInterfaceBinding } from "@echoo/shared";

const bindings: ExternalInterfaceBinding[] = [
  {
    id: "binding_01",
    ownerUserId: "demo",
    interfaceType: "telegram",
    boundConversationId: "conv_aster",
    boundAgentId: "agent_aster",
    displayName: "Interface 01",
    enabled: true,
    createdAt: Date.now(),
  },
];

export class InterfaceBindingRepository {
  list() {
    return bindings;
  }
}
