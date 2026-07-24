import type { Conversation } from "@echoo/shared";
import type {
  NotificationPermissionState,
  NotificationState,
} from "@echoo/shared/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRuntime } from "../../app/providers/RuntimeProvider";
import { useServices } from "../../app/providers/ServicesProvider";
import type {
  MessageRuntime,
  NotificationRuntime,
} from "../../runtimes/contracts";

const EMPTY_NOTIFICATION_STATE: NotificationState = {
  activityUnread: false,
  activityUpdatedAt: 0,
};

const AUTO_PERMISSION_REQUEST_KEY =
  "notification.permission-auto-requested.v1";

export function useNotificationCenter(input: {
  userId?: string;
  activeView: string;
  activeConversationId?: string;
}) {
  const runtime = useRuntime();
  const services = useServices();
  const queryClient = useQueryClient();
  const [permissionState, setPermissionState] =
    useState<NotificationPermissionState>("unsupported");
  const [promptDismissed, setPromptDismissed] = useState(true);
  const [activityRefreshVersion, setActivityRefreshVersion] = useState(0);
  const activeViewRef = useRef(input.activeView);
  const activeConversationIdRef = useRef(input.activeConversationId);
  const liveRef = useRef(runtime.message.getSyncStatus() === "live");

  activeViewRef.current = input.activeView;
  activeConversationIdRef.current = input.activeConversationId;

  const conversationQueryKey = useMemo(
    () => ["conversations", input.userId ?? "anonymous"] as const,
    [input.userId],
  );
  const notificationQueryKey = useMemo(
    () => ["notification-state", input.userId ?? "anonymous"] as const,
    [input.userId],
  );

  const conversationsQuery = useQuery({
    queryKey: conversationQueryKey,
    queryFn: () => services.conversationService.listConversations(),
    enabled: Boolean(input.userId),
    staleTime: Infinity,
  });
  const notificationQuery = useQuery({
    queryKey: notificationQueryKey,
    queryFn: () => services.notificationService.getState(),
    enabled: Boolean(input.userId),
    staleTime: Infinity,
  });

  const setConversation = useCallback(
    (conversation: Conversation) =>
      queryClient.setQueryData<Conversation[]>(
        conversationQueryKey,
        (current = []) => upsertConversation(current, conversation),
      ),
    [conversationQueryKey, queryClient],
  );

  const markConversationRead = useCallback(
    (conversationId: string) => {
      queryClient.setQueryData<Conversation[]>(
        conversationQueryKey,
        (current = []) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, unreadCount: 0 }
              : conversation,
          ),
      );
      void services.conversationService
        .markRead(conversationId)
        .then((readConversation) =>
          queryClient.setQueryData<Conversation[]>(
            conversationQueryKey,
            (current = []) => {
              const latest = current.find(
                (conversation) => conversation.id === conversationId,
              );
              if (
                latest &&
                latest.unreadCount > 0 &&
                latest.updatedAt >= readConversation.updatedAt
              )
                return current;
              return upsertConversation(current, readConversation);
            },
          ),
        )
        .catch(() =>
          queryClient.invalidateQueries({ queryKey: conversationQueryKey }),
        );
    },
    [
      conversationQueryKey,
      queryClient,
      services.conversationService,
      setConversation,
    ],
  );

  const markActivityRead = useCallback(() => {
    queryClient.setQueryData<NotificationState>(
      notificationQueryKey,
      (current) => ({
        ...(current ?? EMPTY_NOTIFICATION_STATE),
        activityUnread: false,
      }),
    );
    void services.notificationService
      .markActivityRead()
      .then((state: NotificationState) =>
        queryClient.setQueryData<NotificationState>(
          notificationQueryKey,
          (current) =>
            current && current.activityUpdatedAt > state.activityUpdatedAt
              ? current
              : state,
        ),
      )
      .catch(() =>
        queryClient.invalidateQueries({ queryKey: notificationQueryKey }),
      );
  }, [notificationQueryKey, queryClient, services.notificationService]);

  useEffect(() => {
    if (!input.userId) return;
    const dismissKey = permissionPromptKey(input.userId);
    setPromptDismissed(localStorage.getItem(dismissKey) === "1");
    let cancelled = false;
    const syncPermission = async (allowAutomaticRequest = false) => {
      if (allowAutomaticRequest) {
        const state = await initializeNotificationPermission({
          notification: runtime.notification,
          message: runtime.message,
          storage: localStorage,
          isCancelled: () => cancelled,
        });
        if (!cancelled) setPermissionState(state);
        return;
      }
      const state = await runtime.notification.getPermissionState();
      if (cancelled) return;
      setPermissionState(state);
      await runtime.message.setBackgroundNotificationsEnabled(
        state === "granted",
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncPermission();
    };
    void syncPermission(true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [input.userId, runtime.message, runtime.notification]);

  useEffect(() => {
    if (!input.userId) return;
    const unsubscribeStatus = runtime.message.onSyncStatusChange((status) => {
      liveRef.current = status === "live";
    });
    const unsubscribeChange = runtime.message.onSyncChange((change) => {
      if (
        change.entityType === "conversation" &&
        change.entity?.entityType === "conversation"
      ) {
        const conversation = change.entity.value;
        const current =
          queryClient.getQueryData<Conversation[]>(conversationQueryKey) ?? [];
        const previous = current.find((item) => item.id === conversation.id);
        const targetIsVisible =
          document.visibilityState === "visible" &&
          activeConversationIdRef.current === conversation.id;
        if (targetIsVisible && conversation.unreadCount > 0) {
          setConversation({ ...conversation, unreadCount: 0 });
          markConversationRead(conversation.id);
          return;
        }
        setConversation(conversation);
        if (
          liveRef.current &&
          conversation.unreadCount > (previous?.unreadCount ?? 0)
        )
          void runtime.notification.showNotification({
            id: `conversation:${conversation.id}`,
            kind: "message",
            title: "Echoo",
            body: `${conversation.title}发来一条新消息`,
            conversationId: conversation.id,
          });
        return;
      }
      if (
        change.entityType === "notification-state" &&
        change.entity?.entityType === "notification-state"
      ) {
        const state = change.entity.value;
        const previous =
          queryClient.getQueryData<NotificationState>(notificationQueryKey) ??
          EMPTY_NOTIFICATION_STATE;
        const targetIsVisible =
          document.visibilityState === "visible" &&
          activeViewRef.current === "explore";
        if (targetIsVisible && state.activityUnread) {
          queryClient.setQueryData(notificationQueryKey, {
            ...state,
            activityUnread: false,
          });
          setActivityRefreshVersion((current) => current + 1);
          markActivityRead();
          return;
        }
        queryClient.setQueryData(notificationQueryKey, state);
        if (
          liveRef.current &&
          state.activityUnread &&
          state.activityUpdatedAt > previous.activityUpdatedAt
        )
          void runtime.notification.showNotification({
            id: "activity",
            kind: "activity",
            title: "Echoo",
            body: "你有一条新的动态待查看",
          });
      }
    });
    const unsubscribeReset = runtime.message.onSyncReset(() => {
      void queryClient.invalidateQueries({ queryKey: conversationQueryKey });
      void queryClient.invalidateQueries({ queryKey: notificationQueryKey });
    });
    return () => {
      unsubscribeStatus();
      unsubscribeChange();
      unsubscribeReset();
    };
  }, [
    conversationQueryKey,
    input.userId,
    markActivityRead,
    markConversationRead,
    notificationQueryKey,
    queryClient,
    runtime.message,
    runtime.notification,
    setConversation,
  ]);

  useEffect(() => {
    if (
      input.userId &&
      input.activeConversationId &&
      document.visibilityState === "visible"
    )
      markConversationRead(input.activeConversationId);
  }, [input.activeConversationId, input.userId, markConversationRead]);

  useEffect(() => {
    if (
      input.userId &&
      input.activeView === "explore" &&
      document.visibilityState === "visible"
    )
      markActivityRead();
  }, [input.activeView, input.userId, markActivityRead]);

  useEffect(() => {
    if (!input.userId) return;
    const consumeVisibleTarget = () => {
      if (document.visibilityState !== "visible") return;
      if (activeConversationIdRef.current)
        markConversationRead(activeConversationIdRef.current);
      if (activeViewRef.current === "explore") markActivityRead();
    };
    document.addEventListener("visibilitychange", consumeVisibleTarget);
    return () =>
      document.removeEventListener("visibilitychange", consumeVisibleTarget);
  }, [input.userId, markActivityRead, markConversationRead]);

  const requestPermission = useCallback(async () => {
    const granted = await runtime.notification.requestPermission();
    const state = granted
      ? "granted"
      : await runtime.notification.getPermissionState();
    setPermissionState(state);
    await runtime.message.setBackgroundNotificationsEnabled(granted);
    return granted;
  }, [runtime.message, runtime.notification]);

  const dismissPrompt = useCallback(() => {
    if (input.userId)
      localStorage.setItem(permissionPromptKey(input.userId), "1");
    setPromptDismissed(true);
  }, [input.userId]);

  const conversations = conversationsQuery.data ?? [];
  const notificationState = notificationQuery.data ?? EMPTY_NOTIFICATION_STATE;
  return {
    conversations,
    notificationState,
    hasUnreadMessages: hasUnreadConversations(conversations),
    activityRefreshVersion,
    permissionState,
    shouldPromptPermission:
      Boolean(input.userId) && permissionState === "prompt" && !promptDismissed,
    markConversationRead,
    markActivityRead,
    requestPermission,
    openNotificationSettings: runtime.notification.openSettings,
    dismissPrompt,
  };
}

export function upsertConversation(
  conversations: Conversation[],
  incoming: Conversation,
) {
  return [incoming, ...conversations.filter((item) => item.id !== incoming.id)];
}

export function hasUnreadConversations(conversations: Conversation[]) {
  return conversations.some((conversation) => conversation.unreadCount > 0);
}

export async function initializeNotificationPermission(input: {
  notification: NotificationRuntime;
  message: Pick<MessageRuntime, "setBackgroundNotificationsEnabled">;
  storage: Pick<Storage, "getItem" | "setItem">;
  isCancelled?: () => boolean;
}) {
  let state = await input.notification.getPermissionState();
  const shouldRequestAutomatically =
    state === "prompt" &&
    input.notification.permissionRequestMode === "automatic" &&
    input.storage.getItem(AUTO_PERMISSION_REQUEST_KEY) !== "1";

  if (shouldRequestAutomatically) {
    input.storage.setItem(AUTO_PERMISSION_REQUEST_KEY, "1");
    const granted = await input.notification.requestPermission();
    state = granted
      ? "granted"
      : await input.notification.getPermissionState();
  }

  if (!input.isCancelled?.())
    await input.message.setBackgroundNotificationsEnabled(state === "granted");
  return state;
}

function permissionPromptKey(userId: string) {
  return `notification.permission-prompt-dismissed.v1:${userId}`;
}
