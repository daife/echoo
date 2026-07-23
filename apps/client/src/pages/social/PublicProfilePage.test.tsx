import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicProfileAssetFilters } from "./PublicProfilePage";

describe("PublicProfileAssetFilters", () => {
  it("keeps all four asset filters on one horizontally scrollable row", () => {
    const html = renderToStaticMarkup(
      <PublicProfileAssetFilters assetType="all" onChange={vi.fn()} />,
    );

    expect(html).toContain("flex-nowrap");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("shrink-0");
    expect(html).toContain("全部");
    expect(html).toContain("切片角色");
    expect(html).toContain("本初角色");
    expect(html).toContain("本初世界");
  });
});
