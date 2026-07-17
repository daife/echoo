import type { CharacterAssetSummary } from "@echoo/shared";
import { describe, expect, it } from "vitest";
import {
  PRIME_FIGURE_UPDATE_WARNING,
  requiresPrimeFigureUpdateWarning,
} from "./ExplorePage";

function asset(
  type: "prime-figure" | "slice-figure",
  installedVersionId?: string,
  updateAvailable = false,
) {
  return {
    snapshot: { type },
    installedVersionId,
    updateAvailable,
  } as CharacterAssetSummary;
}

describe("public character update warning", () => {
  it("warns only before an installed prime figure update", () => {
    expect(
      requiresPrimeFigureUpdateWarning(asset("prime-figure", "aver_old", true)),
    ).toBe(true);
    expect(
      requiresPrimeFigureUpdateWarning(asset("slice-figure", "aver_old", true)),
    ).toBe(false);
    expect(requiresPrimeFigureUpdateWarning(asset("prime-figure"))).toBe(false);
  });

  it("names the overwritten state and recommends a JSON backup", () => {
    expect(PRIME_FIGURE_UPDATE_WARNING).toContain("日程");
    expect(PRIME_FIGURE_UPDATE_WARNING).toContain("参数值");
    expect(PRIME_FIGURE_UPDATE_WARNING).toContain("JSON");
  });
});
