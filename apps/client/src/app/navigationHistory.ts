import type { PrimaryNavigationView } from "./navigationPresentation";

export interface ScrollPosition {
  mainTop: number;
  windowTop: number;
}

export interface NavigationSnapshot<TLocation> {
  location: TLocation;
  primaryView: PrimaryNavigationView;
  scrollPosition: ScrollPosition;
}

export function pushNavigationSnapshot<TLocation>(
  history: NavigationSnapshot<TLocation>[],
  snapshot: NavigationSnapshot<TLocation>,
) {
  return [...history, snapshot];
}

export function popNavigationSnapshot<TLocation>(
  history: NavigationSnapshot<TLocation>[],
) {
  return {
    snapshot: history.at(-1),
    history: history.slice(0, -1),
  };
}

export function takePrimaryOriginSnapshot<TLocation>(
  history: NavigationSnapshot<TLocation>[],
  primaryView: PrimaryNavigationView,
) {
  return history.find((entry) => entry.primaryView === primaryView);
}
