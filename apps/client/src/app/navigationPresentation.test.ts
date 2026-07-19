import { describe, expect, it } from "vitest";
import {
  getActivePrimaryNavigationView,
  PRIMARY_NAVIGATION_VIEWS,
  shouldShowDesktopConversationRail,
  shouldShowMobileBottomNav,
  shouldShowMobileConversationList,
} from "./navigationPresentation";

describe("responsive navigation presentation", () => {
  it("places explore third in the primary navigation", () => {
    expect(PRIMARY_NAVIGATION_VIEWS).toEqual([
      "home",
      "messages",
      "explore",
      "profile",
    ]);
  });

  it("keeps the mobile navigation visible on the conversation list", () => {
    expect(shouldShowMobileBottomNav("messages", false, true)).toBe(true);
    expect(shouldShowMobileConversationList("messages", false)).toBe(true);
  });

  it("hides the mobile navigation inside a conversation", () => {
    expect(shouldShowMobileBottomNav("messages", true, true)).toBe(false);
    expect(shouldShowMobileConversationList("messages", true)).toBe(false);
  });

  it("hides the mobile navigation in settings", () => {
    expect(shouldShowMobileBottomNav("settings", false, true)).toBe(false);
    expect(shouldShowMobileConversationList("settings", false)).toBe(false);
  });

  it("keeps the independent public editor focused", () => {
    expect(shouldShowDesktopConversationRail("public-editor", true)).toBe(
      false,
    );
    expect(shouldShowMobileBottomNav("public-editor", false, true)).toBe(false);
  });

  it("shows the mobile navigation on regular top-level views", () => {
    expect(shouldShowMobileBottomNav("home", false, true)).toBe(true);
    expect(shouldShowMobileBottomNav("profile", false, true)).toBe(true);
    expect(shouldShowMobileConversationList("profile", false)).toBe(false);
  });

  it("keeps an exit visible while a protected page shows authentication", () => {
    expect(shouldShowMobileBottomNav("messages", true, false)).toBe(true);
    expect(shouldShowMobileBottomNav("settings", false, false)).toBe(true);
  });

  it("shows the desktop conversation rail on shared content views", () => {
    for (const view of [
      "home",
      "messages",
      "explore",
      "profile",
      "settings",
      "bindings",
    ] as const) {
      expect(shouldShowDesktopConversationRail(view, true)).toBe(true);
    }
    expect(shouldShowDesktopConversationRail("create", true)).toBe(false);
    expect(shouldShowDesktopConversationRail("auth", true)).toBe(false);
  });

  it("only shows public desktop rails before authentication", () => {
    expect(shouldShowDesktopConversationRail("home", false)).toBe(true);
    expect(shouldShowDesktopConversationRail("explore", false)).toBe(true);
    expect(shouldShowDesktopConversationRail("profile", false)).toBe(false);
    expect(shouldShowDesktopConversationRail("messages", false)).toBe(false);
  });

  it("keeps profile active in settings", () => {
    expect(getActivePrimaryNavigationView("settings", "home", "home")).toBe(
      "profile",
    );
  });

  it("keeps the binding source navigation item active", () => {
    expect(getActivePrimaryNavigationView("bindings", "explore", "home")).toBe(
      "explore",
    );
    expect(getActivePrimaryNavigationView("bindings", "settings", "home")).toBe(
      "profile",
    );
  });

  it("keeps the source navigation active on secondary pages", () => {
    expect(getActivePrimaryNavigationView("create", "home", "home")).toBe(
      "home",
    );
    expect(
      getActivePrimaryNavigationView("character-detail", "home", "home"),
    ).toBe("home");
    expect(
      getActivePrimaryNavigationView("character-detail", "home", "explore"),
    ).toBe("explore");
    expect(
      getActivePrimaryNavigationView("public-editor", "home", "profile"),
    ).toBe("profile");
    expect(
      getActivePrimaryNavigationView("public-profile", "home", "profile"),
    ).toBe("profile");
  });
});
