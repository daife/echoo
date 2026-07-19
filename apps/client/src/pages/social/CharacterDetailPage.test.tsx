import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterDetailPage } from "./CharacterDetailPage";

describe("CharacterDetailPage unavailable state", () => {
  it("keeps a return action while the source asset is loading or unavailable", () => {
    const html = renderToStaticMarkup(
      <CharacterDetailPage
        assetId="asset_missing"
        characterService={{ get: vi.fn() } as never}
        socialService={{} as never}
        isAuthenticated
        onRequireAuth={vi.fn()}
        onBack={vi.fn()}
        onOpenUser={vi.fn()}
        onAgentInstalled={vi.fn()}
      />,
    );

    expect(html).toContain("返回");
    expect(html).toContain("正在加载角色");
  });
});
