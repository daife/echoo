import { openDB, type DBSchema } from "idb";
import type { LocalMessage, SyncTask } from "@echoo/shared";

interface EchooDb extends DBSchema {
  messages: {
    key: string;
    value: LocalMessage;
    indexes: {
      "by-conversation": string;
      "by-conversation-created-at": [string, number];
      "by-created-at": number;
    };
  };
  syncTasks: {
    key: string;
    value: SyncTask;
  };
}

export function getEchooDb() {
  return openDB<EchooDb>("echoo", 2, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
      const messages = db.objectStoreNames.contains("messages")
        ? transaction.objectStore("messages")
        : db.createObjectStore("messages", { keyPath: "id" });

      if (!messages.indexNames.contains("by-conversation")) {
        messages.createIndex("by-conversation", "conversationId");
      }
      if (!messages.indexNames.contains("by-conversation-created-at")) {
        messages.createIndex("by-conversation-created-at", ["conversationId", "createdAt"]);
      }
      if (!messages.indexNames.contains("by-created-at")) {
        messages.createIndex("by-created-at", "createdAt");
      }
      if (!db.objectStoreNames.contains("syncTasks")) {
        db.createObjectStore("syncTasks", { keyPath: "id" });
      }
    }
  });
}
