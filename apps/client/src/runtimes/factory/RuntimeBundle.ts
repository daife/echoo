import type {
  AppNavigationRuntime,
  AuthRuntime,
  LinkRuntime,
  MessageRuntime,
  NotificationRuntime,
  StorageRuntime,
} from "../contracts";

export interface RuntimeBundle {
  appNavigation: AppNavigationRuntime;
  auth: AuthRuntime;
  storage: StorageRuntime;
  link: LinkRuntime;
  message: MessageRuntime;
  notification: NotificationRuntime;
}
