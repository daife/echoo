export type ResponsiveNavigationView =
  | "home"
  | "messages"
  | "bindings"
  | "settings"
  | "explore"
  | "profile"
  | "create"
  | "auth";

export function shouldShowMobileBottomNav(
  view: ResponsiveNavigationView,
  hasSelectedAgent: boolean,
  isAuthenticated: boolean,
) {
  if (!isAuthenticated && (view === "settings" || view === "messages"))
    return true;
  return view !== "settings" && !(view === "messages" && hasSelectedAgent);
}

export function shouldShowMobileConversationList(
  view: ResponsiveNavigationView,
  hasSelectedAgent: boolean,
) {
  return view === "messages" && !hasSelectedAgent;
}
