import type { CharacterAssetListItem } from "@echoo/shared";
import { describe, expect, it, vi } from "vitest";
import {
  CHARACTER_SEARCH_DEBOUNCE_MS,
  PRIME_FIGURE_UPDATE_WARNING,
  isCharacterSearchQueryInvalid,
  mergeUniqueCharacterAssets,
  normalizeCharacterSearchQuery,
  requiresPrimeFigureUpdateWarning,
  scheduleCharacterSearch,
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
  } as CharacterAssetListItem;
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

describe("public character catalog search", () => {
  it("normalizes input and enforces the two-to-fifty character range", () => {
    expect(normalizeCharacterSearchQuery("  林晚   插画师 ")).toBe(
      "林晚 插画师",
    );
    expect(isCharacterSearchQueryInvalid("林")).toBe(true);
    expect(isCharacterSearchQueryInvalid("林晚")).toBe(false);
    expect(isCharacterSearchQueryInvalid("a".repeat(51))).toBe(true);
  });

  it("waits 300ms and supports cancelling a pending search", () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const cancel = scheduleCharacterSearch("林晚", onReady);
    vi.advanceTimersByTime(CHARACTER_SEARCH_DEBOUNCE_MS - 1);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReady).toHaveBeenCalledWith("林晚");
    cancel();

    const cancelled = vi.fn();
    scheduleCharacterSearch("作者", cancelled)();
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("deduplicates appended pages by asset id", () => {
    const first = { id: "asset_1" } as CharacterAssetListItem;
    const second = { id: "asset_2" } as CharacterAssetListItem;
    expect(mergeUniqueCharacterAssets([first], [first, second])).toEqual([
      first,
      second,
    ]);
  });
});
