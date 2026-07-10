import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AiTextProvider, ChatCompletionInput } from "../../../ai/ai-provider.interface.js";
import { AiProviderRegistry } from "../../../ai/ai-provider.registry.js";
import { closeDatabase, getDatabase } from "../../../../infra/database/sqlite.js";
import { AgentRepository } from "../../agent.repository.js";
import { UserRepository } from "../../../auth/user.repository.js";
import { MessageRepository } from "../../../messaging/message.repository.js";
import { SliceFigureHandler } from "./slice-figure.handler.js";
import { SliceFigureRuntimeService } from "./slice-figure-runtime.service.js";

class FakeProvider implements AiTextProvider {
  readonly id = "openrouter" as const;
  readonly inputs: ChatCompletionInput[] = [];

  async createChatCompletion(input: ChatCompletionInput) {
    this.inputs.push(input);
    return {
      text: "你好。",
      providerId: this.id,
      model: input.model,
    };
  }
}

test("Slice Figure resolves only creator-approved prompt placeholders", async () => {
  const directory = mkdtempSync(join(tmpdir(), "echoo-slice-runtime-"));
  process.env.AUTH_DATABASE_FILE = join(directory, "test.sqlite");

  try {
    const db = getDatabase();
    const now = Date.now();
    db.prepare(
      "INSERT INTO auth_users (id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("slice_user", "private@example.test", "小林", "test", now, now);

    const agent = new SliceFigureHandler().create("slice_user", {
      type: "slice-figure",
      name: "Mira",
      isPublic: false,
      persona: "一个克制的朋友",
      background: "住在上海",
      personality: "安静",
      responseStyle: "简短自然",
      systemPrompt:
        "称呼：{{user.name}}\n人设：{{figure.persona}}\n邮箱：{{user.email}}",
    });
    const messages = new MessageRepository();
    messages.save({
      ownerUserId: "slice_user",
      id: "msg_slice_user",
      conversationId: agent.conversationId,
      role: "user",
      contentType: "text",
      content: { text: "在吗？" },
      status: "sent",
      createdAt: now,
      updatedAt: now,
    });

    const provider = new FakeProvider();
    const registry = {
      getDefaultProvider: () => provider,
      getDefaultModel: () => "test/slice-figure",
    } as unknown as AiProviderRegistry;
    const runtime = new SliceFigureRuntimeService(
      new AgentRepository(),
      messages,
      registry,
      new UserRepository(),
    );

    const result = await runtime.createReply({
      ownerUserId: "slice_user",
      conversationId: agent.conversationId,
    });
    assert.equal(result?.text, "你好。");
    assert.equal(
      provider.inputs[0]?.messages[0]?.content,
      "称呼：小林\n人设：一个克制的朋友\n邮箱：{{user.email}}",
    );
    assert.equal(provider.inputs[0]?.messages[1]?.content, "在吗？");
    assert.doesNotMatch(
      provider.inputs[0]?.messages[0]?.content ?? "",
      /private@example\.test/,
    );
  } finally {
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.AUTH_DATABASE_FILE;
  }
});
