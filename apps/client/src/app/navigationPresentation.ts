export type ResponsiveNavigationView =
  | "home"
  | "messages"
  | "bindings"
  | "settings"
  | "explore"
  | "profile"
  | "create"
  | "public-editor"
  | "auth";

export const PRIMARY_NAVIGATION_VIEWS = [
  "home",
  "messages",
  "explore",
  "profile",
] as const;

export type PrimaryNavigationView = (typeof PRIMARY_NAVIGATION_VIEWS)[number];

export function shouldShowDesktopConversationRail(
  view: ResponsiveNavigationView,
  isAuthenticated: boolean,
) {
  if (view === "auth" || view === "create" || view === "public-editor")
    return false;
  if (view === "home" || view === "explore") return true;
  return isAuthenticated;
}

export function getActivePrimaryNavigationView(
  view: ResponsiveNavigationView,
  bindingsReturnView: ResponsiveNavigationView,
): PrimaryNavigationView | null {
  if (view === "settings") return "profile";
  if (view === "bindings") {
    return bindingsReturnView === "settings"
      ? "profile"
      : toPrimaryNavigationView(bindingsReturnView);
  }
  return toPrimaryNavigationView(view);
}

export function shouldShowMobileBottomNav(
  view: ResponsiveNavigationView,
  hasSelectedAgent: boolean,
  isAuthenticated: boolean,
) {
  if (!isAuthenticated && (view === "settings" || view === "messages"))
    return true;
  if (view === "public-editor") return false;
  return view !== "settings" && !(view === "messages" && hasSelectedAgent);
}

export function shouldShowMobileConversationList(
  view: ResponsiveNavigationView,
  hasSelectedAgent: boolean,
) {
  return view === "messages" && !hasSelectedAgent;
}

function toPrimaryNavigationView(
  view: ResponsiveNavigationView,
): PrimaryNavigationView | null {
  return view === "home" ||
    view === "messages" ||
    view === "explore" ||
    view === "profile"
    ? view
    : null;
}
