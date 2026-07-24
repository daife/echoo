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
  entryId: "home-entry",
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
      entryId: "detail-entry",
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

  it("returns from a character detail to the profile origin and its scroll position", () => {
    const profileSnapshot: NavigationSnapshot<TestLocation> = {
      entryId: "profile-entry",
      location: { view: "profile", assetId: null },
      primaryView: "profile",
      scrollPosition: { mainTop: 520, windowTop: 0 },
    };
    const result = popNavigationSnapshot(
      pushNavigationSnapshot([], profileSnapshot),
    );

    expect(result.snapshot).toEqual(profileSnapshot);
    expect(result.snapshot?.scrollPosition.mainTop).toBe(520);
  });

  it("finds the original source when the active primary item is clicked", () => {
    const nestedSnapshot: NavigationSnapshot<TestLocation> = {
      entryId: "nested-entry",
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

  it("keeps stable entry identities while popping nested pages", () => {
    const nestedSnapshot: NavigationSnapshot<TestLocation> = {
      entryId: "nested-entry",
      location: { view: "public-profile", assetId: null },
      primaryView: "explore",
      scrollPosition: { mainTop: 240, windowTop: 0 },
    };
    const history = pushNavigationSnapshot([homeSnapshot], nestedSnapshot);
    const result = popNavigationSnapshot(history);

    expect(result.snapshot?.entryId).toBe("nested-entry");
    expect(result.history[0]?.entryId).toBe("home-entry");
  });
});
