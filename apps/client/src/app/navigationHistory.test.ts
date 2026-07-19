import { describe, expect, it } from "vitest";
import {
  popNavigationSnapshot,
  pushNavigationSnapshot,
  takePrimaryOriginSnapshot,
  type NavigationSnapshot,
} from "./navigationHistory";

interface TestLocation {
  view: string;
  assetId: string | null;
}

const homeSnapshot: NavigationSnapshot<TestLocation> = {
  location: { view: "home", assetId: null },
  primaryView: "home",
  scrollPosition: { mainTop: 640, windowTop: 320 },
};

describe("navigation history", () => {
  it("preserves location, source navigation, and both scroll positions", () => {
    const history = pushNavigationSnapshot([], homeSnapshot);
    expect(popNavigationSnapshot(history)).toEqual({
      snapshot: homeSnapshot,
      history: [],
    });
  });

  it("returns through nested detail pages one level at a time", () => {
    const detailSnapshot: NavigationSnapshot<TestLocation> = {
      location: { view: "character-detail", assetId: "asset-1" },
      primaryView: "home",
      scrollPosition: { mainTop: 180, windowTop: 90 },
    };
    const history = [homeSnapshot, detailSnapshot];
    const firstReturn = popNavigationSnapshot(history);
    expect(firstReturn.snapshot).toBe(detailSnapshot);
    expect(popNavigationSnapshot(firstReturn.history).snapshot).toBe(
      homeSnapshot,
    );
  });

  it("finds the original source when the active primary item is clicked", () => {
    const nestedSnapshot: NavigationSnapshot<TestLocation> = {
      location: { view: "public-profile", assetId: "asset-1" },
      primaryView: "home",
      scrollPosition: { mainTop: 0, windowTop: 0 },
    };
    expect(
      takePrimaryOriginSnapshot([homeSnapshot, nestedSnapshot], "home"),
    ).toBe(homeSnapshot);
    expect(
      takePrimaryOriginSnapshot([homeSnapshot, nestedSnapshot], "profile"),
    ).toBeUndefined();
  });
});
