import { describe, expect, it } from "vitest";
import {
  shouldShowMobileBottomNav,
  shouldShowMobileConversationList,
} from "./navigationPresentation";

describe("responsive navigation presentation", () => {
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

  it("shows the mobile navigation on regular top-level views", () => {
    expect(shouldShowMobileBottomNav("home", false, true)).toBe(true);
    expect(shouldShowMobileBottomNav("profile", false, true)).toBe(true);
    expect(shouldShowMobileConversationList("profile", false)).toBe(false);
  });

  it("keeps an exit visible while a protected page shows authentication", () => {
    expect(shouldShowMobileBottomNav("messages", true, false)).toBe(true);
    expect(shouldShowMobileBottomNav("settings", false, false)).toBe(true);
  });
});
