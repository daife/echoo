import type {
  MediaResourceStatus,
  SyncBootstrap,
  SyncChange,
  SyncEntity,
  SyncPage,
} from "@echoo/shared";
import { AgentRepository } from "../agents/agent.repository.js";
import { PublicAssetService } from "../public-assets/public-asset.service.js";
import { MessageRepository } from "../messaging/message.repository.js";
import { ResourceRepository } from "../resources/resource.repository.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { NotificationRepository } from "../notifications/notification.repository.js";
import {
  ChangeEventRepository,
  type ChangeEventRow,
} from "./change-event.repository.js";

export class SyncService {
  constructor(
    private readonly events = new ChangeEventRepository(),
    private readonly agents = new AgentRepository(),
    private readonly messages = new MessageRepository(),
    private readonly resources = new ResourceRepository(),
    private readonly assets = new PublicAssetService(),
    private readonly conversations = new ConversationRepository(),
    private readonly notifications = new NotificationRepository(),
  ) {}

  async bootstrap(ownerUserId: string): Promise<SyncBootstrap> {
    const [agents, assets, conversations, notificationState, cursor] =
      await Promise.all([
        this.agents.listByOwner(ownerUserId),
        this.assets.listMine(ownerUserId),
        this.conversations.listByOwner(ownerUserId),
        this.notifications.getState(ownerUserId),
        this.events.head(ownerUserId),
      ]);
    return { agents, assets, conversations, notificationState, cursor };
  }

  async list(
    ownerUserId: string,
    after = 0,
    requestedLimit = 500,
  ): Promise<SyncPage> {
    const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 500);
    const [headCursor, oldestCursor] = await Promise.all([
      this.events.head(ownerUserId),
      this.events.oldest(ownerUserId),
    ]);
    if (after > 0 && oldestCursor > 0 && after < oldestCursor - 1)
      return {
        cursor: after,
        headCursor,
        hasMore: false,
        resetRequired: true,
        changes: [],
      };

    const rows = await this.events.listAfter(ownerUserId, after, limit + 1);
    const hasMore = rows.length > limit;
    if (hasMore) rows.splice(limit);
    const coalesced = coalesceRows(rows);
    const changes = (
      await Promise.all(coalesced.map((row) => this.hydrate(row)))
    ).filter((change): change is SyncChange => Boolean(change));
    return {
      cursor: rows.at(-1)?.seq ?? after,
      headCursor,
      hasMore,
      resetRequired: false,
      changes,
    };
  }

  async hydrate(row: ChangeEventRow): Promise<SyncChange | null> {
    const base = {
      cursor: row.seq,
      entityType: row.entity_type,
      entityId: row.entity_id,
      ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
      operation: row.operation,
      createdAt: row.created_at,
    } as const;
    if (row.operation === "delete") return base;
    const entity = await this.readEntity(row);
    return entity ? { ...base, entity } : { ...base, operation: "delete" };
  }

  private async readEntity(row: ChangeEventRow): Promise<SyncEntity | null> {
    if (row.entity_type === "agent") {
      const value = await this.agents.findById(
        row.owner_user_id,
        row.entity_id,
      );
      return value ? { entityType: "agent", value } : null;
    }
    if (row.entity_type === "message") {
      if (!row.conversation_id) return null;
      const value = await this.messages.findByIdInConversation(
        row.owner_user_id,
        row.conversation_id,
        row.entity_id,
      );
      return value ? { entityType: "message", value } : null;
    }
    if (row.entity_type === "resource") {
      const resource = await this.resources.findById(row.entity_id);
      if (!resource || resource.ownerUserId !== row.owner_user_id) return null;
      const value: MediaResourceStatus = {
        resourceId: resource.id,
        status: resource.status,
        mimeType: resource.mimeType,
        ...(resource.byteSize !== undefined
          ? { byteSize: resource.byteSize }
          : {}),
        ...(resource.durationSeconds !== undefined
          ? { durationSeconds: resource.durationSeconds }
          : {}),
      };
      return { entityType: "resource", value };
    }
    if (row.entity_type === "conversation") {
      const value = await this.conversations.findByIdForOwner(
        row.owner_user_id,
        row.entity_id,
      );
      return value ? { entityType: "conversation", value } : null;
    }
    if (row.entity_type === "notification-state") {
      return {
        entityType: "notification-state",
        value: await this.notifications.getState(row.owner_user_id),
      };
    }
    if (row.entity_type !== "asset") return null;
    try {
      return {
        entityType: "asset",
        value: await this.assets.getDraft(row.owner_user_id, row.entity_id),
      };
    } catch {
      return null;
    }
  }
}

export function coalesceRows(rows: ChangeEventRow[]) {
  const latest = new Map<string, ChangeEventRow>();
  for (const row of rows)
    latest.set(`${row.entity_type}:${row.entity_id}`, row);
  return [...latest.values()].sort((left, right) => left.seq - right.seq);
}
