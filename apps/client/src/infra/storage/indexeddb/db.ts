import { openDB, type DBSchema } from "idb";
import type { LocalMessage, SyncTask } from "@echoo/shared";

interface EchooDb extends DBSchema {
  messages: {
    key: string;
    value: LocalMessage;
    indexes: {
      "by-conversation": string;
      "by-created-at": number;
    };
  };
  syncTasks: {
    key: string;
    value: SyncTask;
  };
}

export function getEchooDb() {
  return openDB<EchooDb>("echoo", 1, {
    upgrade(db) {
      const messages = db.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("by-conversation", "conversationId");
      messages.createIndex("by-created-at", "createdAt");
      db.createObjectStore("syncTasks", { keyPath: "id" });
    }
  });
}
