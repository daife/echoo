export type BackButtonUnlisten = () => void | Promise<void>;

export interface AppNavigationRuntime {
  listenBackButton(handler: () => void): Promise<BackButtonUnlisten>;
}
