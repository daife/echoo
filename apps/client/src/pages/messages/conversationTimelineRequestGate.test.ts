import { describe, expect, it } from "vitest";
import { ConversationTimelineRequestGate } from "./conversationTimelineRequestGate";

describe("conversation timeline request gate", () => {
  it("allows only one timeline request at a time", () => {
    const gate = new ConversationTimelineRequestGate();
    const older = gate.acquire("older");

    expect(older).not.toBeNull();
    expect(gate.acquire("older")).toBeNull();
    expect(gate.acquire("newer")).toBeNull();
    expect(gate.acquire("latest")).toBeNull();

    gate.release(older!);
    expect(gate.acquire("newer")).not.toBeNull();
  });

  it("does not let an obsolete request release a newer lease", () => {
    const gate = new ConversationTimelineRequestGate();
    const obsolete = gate.acquire("older")!;
    gate.reset();
    const current = gate.acquire("latest")!;

    gate.release(obsolete);
    expect(gate.acquire("newer")).toBeNull();

    gate.release(current);
    expect(gate.acquire("newer")).not.toBeNull();
  });
});
