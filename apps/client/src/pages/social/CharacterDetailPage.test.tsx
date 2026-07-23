import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterDetailPage, WorldUpdateDialog } from "./CharacterDetailPage";

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
    expect(html).toContain("正在加载公共资产");
  });
});

describe("WorldUpdateDialog", () => {
  it("offers both update strategies when the current progress is compatible", () => {
    const html = renderToStaticMarkup(
      <WorldUpdateDialog
        compatibility={{ canPreserve: true }}
        busy={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("保留兼容进度");
    expect(html).toContain("重置进度");
    expect(html).not.toContain("只能重置进度");
  });

  it("disables preservation and explains incompatible progress", () => {
    const html = renderToStaticMarkup(
      <WorldUpdateDialog
        compatibility={{ canPreserve: false, reason: "状态结构不兼容。" }}
        busy={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("状态结构不兼容");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*保留兼容进度/s);
    expect(html).toContain("重置进度");
  });
});
