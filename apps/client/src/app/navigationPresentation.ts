export type ResponsiveNavigationView =
  | "home"
  | "messages"
  | "bindings"
  | "settings"
  | "explore"
  | "profile"
  | "create"
  | "public-editor"
  | "post-detail"
  | "character-detail"
  | "public-profile"
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
  if (
    view === "auth" ||
    view === "create" ||
    view === "public-editor" ||
    view === "post-detail" ||
    view === "character-detail" ||
    view === "public-profile"
  )
    return false;
  if (view === "home" || view === "explore") return true;
  return isAuthenticated;
}

export function getActivePrimaryNavigationView(
  view: ResponsiveNavigationView,
  bindingsReturnView: ResponsiveNavigationView,
  secondaryOriginView: PrimaryNavigationView,
): PrimaryNavigationView | null {
  if (view === "settings") return "profile";
  if (view === "bindings") {
    return bindingsReturnView === "settings"
      ? "profile"
      : toPrimaryNavigationView(bindingsReturnView);
  }
  if (
    view === "create" ||
    view === "public-editor" ||
    view === "post-detail" ||
    view === "character-detail" ||
    view === "public-profile"
  )
    return secondaryOriginView;
  return toPrimaryNavigationView(view);
}

export function shouldShowMobileBottomNav(
  view: ResponsiveNavigationView,
  hasSelectedAgent: boolean,
  isAuthenticated: boolean,
) {
  if (!isAuthenticated && (view === "settings" || view === "messages"))
    return true;
  if (
    view === "public-editor" ||
    view === "post-detail" ||
    view === "character-detail" ||
    view === "public-profile"
  )
    return false;
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
