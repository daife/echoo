import type { PrimaryNavigationView } from "./navigationPresentation";

export interface ScrollPosition {
  mainTop: number;
  windowTop: number;
}

export interface NavigationEntry<TLocation> {
  entryId: string;
  location: TLocation;
  primaryView: PrimaryNavigationView;
  scrollPosition: ScrollPosition;
}

export type NavigationStack<TLocation> = NavigationEntry<TLocation>[];

// Kept as an alias so callers outside the navigation owner can migrate without
// creating a second representation of navigation history.
export type NavigationSnapshot<TLocation> = NavigationEntry<TLocation>;

export function pushNavigationSnapshot<TLocation>(
  history: NavigationStack<TLocation>,
  snapshot: NavigationEntry<TLocation>,
) {
  return [...history, snapshot];
}

export function popNavigationSnapshot<TLocation>(
  history: NavigationStack<TLocation>,
) {
  return {
    snapshot: history.at(-1),
    history: history.slice(0, -1),
  };
}

export function takePrimaryOriginSnapshot<TLocation>(
  history: NavigationStack<TLocation>,
  primaryView: PrimaryNavigationView,
) {
  return history.find((entry) => entry.primaryView === primaryView);
}
