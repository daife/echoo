import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterCard, type CharacterCardAgent } from "./CharacterCard";

const baseAgent: CharacterCardAgent = {
  id: "agent_1",
  name: "林晚",
  kind: "切片角色",
  description: "住在厦门的独立插画师。",
  gradient: "from-white/16 via-white/5 to-transparent",
  avatarResourcePath: "/api/resources/avatar/file",
};

describe("CharacterCard", () => {
  it.each([
    ["without a cover", baseAgent],
    [
      "with a cover",
      { ...baseAgent, coverResourcePath: "/api/resources/cover/file" },
    ],
  ])("anchors the circular avatar at the media frame bottom %s", (_, agent) => {
    const html = renderToStaticMarkup(
      <CharacterCard agent={agent} onOpenChat={vi.fn()} />,
    );

    expect(html).toContain("data-character-card-avatar-anchor");
    expect(html).toContain("absolute inset-x-0 bottom-0 z-20 p-5");
    expect(html).toContain("relative shrink-0 rounded-full");
  });

  it("keeps the cover in an absolute media layer", () => {
    const html = renderToStaticMarkup(
      <CharacterCard
        agent={{
          ...baseAgent,
          coverResourcePath: "/api/resources/cover/file",
        }}
        onOpenChat={vi.fn()}
      />,
    );

    expect(html).toContain("absolute inset-0 overflow-hidden");
  });
});
