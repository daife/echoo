import {
  ChatCircleText,
  Compass,
  House,
  UserCircle,
} from "@phosphor-icons/react";
import type {
  Agent,
  AddPrimeFigureStickerRequest,
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
  UpdatePrimeWorldRequest,
} from "@echoo/shared";
import type {
  CreatePublicAssetDraftRequest,
  PublicAssetDraft,
} from "@echoo/shared/public-assets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useServices } from "./providers/ServicesProvider";
import { useAuth } from "./providers/AuthProvider";
import { useRuntime } from "./providers/RuntimeProvider";
import { BindingsPanel } from "../features/bindings/components/BindingsPanel";
import { ConversationRail } from "../features/conversations/components/ConversationRail";
import { NotificationPermissionPrompt } from "../features/notifications/NotificationPermissionPrompt";
import { useNotificationCenter } from "../features/notifications/useNotificationCenter";
import { AuthPage } from "../pages/auth/AuthPage";
import { CreateAgentPage } from "../pages/create-agent/CreateAgentPage";
import { ExplorePage } from "../pages/explore/ExplorePage";
import { HomePage } from "../pages/home/HomePage";
import { MessagesPage } from "../pages/messages/MessagesPage";
import { PrimeWorldPage } from "../pages/prime-world/PrimeWorldPage";
import { ProfilePage } from "../pages/profile/ProfilePage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { PublicAssetEditorPage } from "../pages/public-asset/PublicAssetEditorPage";
import { PostDetailPage } from "../pages/social/PostDetailPage";
import { CharacterDetailPage } from "../pages/social/CharacterDetailPage";
import { PublicProfilePage } from "../pages/social/PublicProfilePage";
import {
  getActivePrimaryNavigationView,
  PRIMARY_NAVIGATION_VIEWS,
  type PrimaryNavigationView,
  shouldShowDesktopConversationRail,
  shouldShowMobileBottomNav,
  shouldShowMobileConversationList,
} from "./navigationPresentation";
import {
  popNavigationSnapshot,
  pushNavigationSnapshot,
  takePrimaryOriginSnapshot,
  type NavigationEntry,
  type NavigationSnapshot,
  type ScrollPosition,
} from "./navigationHistory";
import { resolveAppBackAction, type AppView } from "./backNavigation";
import {
  NavigationLayer,
  useBackHandler,
} from "./providers/BackNavigationProvider";
import { parsePublicLinkTarget, syncPublicLinkTarget } from "./publicLinks";

interface ViewLocation {
  view: AppView;
  postId: string | null;
  assetId: string | null;
  userId: string | null;
}

const navItemPresentation = {
  home: { label: "首页", icon: House },
  messages: { label: "聊天", icon: ChatCircleText },
  explore: { label: "探索", icon: Compass },
  profile: { label: "个人主页", icon: UserCircle },
} satisfies Record<
  PrimaryNavigationView,
  { label: string; icon: typeof House }
>;

const navItems = PRIMARY_NAVIGATION_VIEWS.map((id) => ({
  id,
  ...navItemPresentation[id],
}));

export function App() {
  const auth = useAuth();
  const runtime = useRuntime();
  const services = useServices();
  const queryClient = useQueryClient();
  const [initialPublicTarget] = useState(() =>
    parsePublicLinkTarget(window.location.search),
  );
  const [view, setView] = useState<AppView>(() =>
    new URLSearchParams(window.location.search).has("rechargeOrder")
      ? "settings"
      : initialPublicTarget?.type === "post"
        ? "post-detail"
        : initialPublicTarget?.type === "card"
          ? "character-detail"
          : "home",
  );
  const [bindingsReturnView, setBindingsReturnView] =
    useState<AppView>("messages");
  const [activePrimaryView, setActivePrimaryView] =
    useState<PrimaryNavigationView>(() =>
      new URLSearchParams(window.location.search).has("rechargeOrder")
        ? "profile"
        : "home",
    );
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [editingPublicAsset, setEditingPublicAsset] =
    useState<PublicAssetDraft | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(
    initialPublicTarget?.type === "post" ? initialPublicTarget.id : null,
  );
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    initialPublicTarget?.type === "card" ? initialPublicTarget.id : null,
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const nextNavigationEntryIdRef = useRef(1);
  const [currentEntryId, setCurrentEntryId] = useState("navigation-0");
  const navigationOwnerRef = useRef(auth.user?.id);
  const [navigationHistory, setNavigationHistory] = useState<
    NavigationSnapshot<ViewLocation>[]
  >([]);
  const mainRef = useRef<HTMLElement>(null);
  const pendingScrollPositionRef = useRef<ScrollPosition | null>(null);

  useEffect(() => {
    syncPublicLinkTarget(
      view === "post-detail" && selectedPostId
        ? { type: "post", id: selectedPostId }
        : view === "character-detail" && selectedAssetId
          ? { type: "card", id: selectedAssetId }
          : null,
    );
  }, [selectedAssetId, selectedPostId, view]);
  const agentQueryKey = useMemo(
    () => ["agents", "mine", auth.user?.id ?? "anonymous"] as const,
    [auth.user?.id],
  );
  const assetQueryKey = useMemo(
    () => ["assets", "mine", auth.user?.id ?? "anonymous"] as const,
    [auth.user?.id],
  );
  const agentsQuery = useQuery({
    queryKey: agentQueryKey,
    queryFn: () => services.agentService.listMyAgents(auth.user?.id),
    enabled: Boolean(auth.user),
    staleTime: Infinity,
  });
  const assetsQuery = useQuery({
    queryKey: assetQueryKey,
    queryFn: () => services.publicAssetService.listMine(),
    enabled: Boolean(auth.user),
    staleTime: Infinity,
  });
  const myAgents = agentsQuery.data ?? [];
  const publicAssets = assetsQuery.data ?? [];
  const isLoadingAgents = agentsQuery.isPending && Boolean(auth.user);
  const setMyAgents = useCallback(
    (update: SetStateAction<Agent[]>) =>
      queryClient.setQueryData<Agent[]>(agentQueryKey, (current = []) =>
        resolveStateUpdate(update, current),
      ),
    [agentQueryKey, queryClient],
  );
  const setPublicAssets = useCallback(
    (update: SetStateAction<PublicAssetDraft[]>) =>
      queryClient.setQueryData<PublicAssetDraft[]>(
        assetQueryKey,
        (current = []) => resolveStateUpdate(update, current),
      ),
    [assetQueryKey, queryClient],
  );
  const showConversationRail = shouldShowDesktopConversationRail(
    view,
    !!auth.user,
  );
  const activeNavView = getActivePrimaryNavigationView(
    view,
    bindingsReturnView,
    activePrimaryView,
  );
  const isViewportPanel = view === "messages" || view === "bindings";
  const isMobileChatFullscreen = view === "messages" && !!selectedAgent;
  const showMobileBottomNav = shouldShowMobileBottomNav(
    view,
    !!selectedAgent,
    !!auth.user,
  );
  const showMobileConversationList =
    !!auth.user && shouldShowMobileConversationList(view, !!selectedAgent);
  const notificationCenter = useNotificationCenter({
    userId: auth.user?.id,
    activeView: view,
    activeConversationId:
      view === "messages" ? selectedAgent?.conversationId : undefined,
  });

  useLayoutEffect(() => {
    const position = pendingScrollPositionRef.current;
    if (!position) return;
    pendingScrollPositionRef.current = null;
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      attempts += 1;
      if (mainRef.current) mainRef.current.scrollTop = position.mainTop;
      window.scrollTo({ top: position.windowTop, behavior: "instant" });
      const mainTop = mainRef.current?.scrollTop ?? position.mainTop;
      const mainRestored = Math.abs(mainTop - position.mainTop) <= 1;
      const windowRestored = Math.abs(window.scrollY - position.windowTop) <= 1;
      if ((!mainRestored || !windowRestored) && attempts < 180)
        frame = window.requestAnimationFrame(restore);
    };
    frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, [view, selectedPostId, selectedAssetId, selectedUserId]);

  const captureScrollPosition = useCallback(
    (): ScrollPosition => ({
      mainTop: mainRef.current?.scrollTop ?? 0,
      windowTop: window.scrollY,
    }),
    [],
  );

  const beginNavigationEntry = useCallback(() => {
    setCurrentEntryId(`navigation-${nextNavigationEntryIdRef.current++}`);
  }, []);

  useEffect(() => {
    if (navigationOwnerRef.current === auth.user?.id) return;
    navigationOwnerRef.current = auth.user?.id;
    setNavigationHistory([]);
    beginNavigationEntry();
    queryClient.removeQueries({ queryKey: ["social-lists"] });
    queryClient.removeQueries({ queryKey: ["social-profile"] });
  }, [auth.user?.id, beginNavigationEntry, queryClient]);

  const currentLocation = useCallback(
    (): ViewLocation => ({
      view,
      postId: selectedPostId,
      assetId: selectedAssetId,
      userId: selectedUserId,
    }),
    [selectedAssetId, selectedPostId, selectedUserId, view],
  );

  const createCurrentSnapshot = useCallback(
    (): NavigationSnapshot<ViewLocation> => ({
      entryId: currentEntryId,
      location: currentLocation(),
      primaryView: activePrimaryView,
      scrollPosition: captureScrollPosition(),
    }),
    [activePrimaryView, captureScrollPosition, currentEntryId, currentLocation],
  );

  const restoreSnapshot = useCallback(
    (snapshot: NavigationSnapshot<ViewLocation>) => {
      setSelectedPostId(snapshot.location.postId);
      setSelectedAssetId(snapshot.location.assetId);
      setSelectedUserId(snapshot.location.userId);
      setActivePrimaryView(snapshot.primaryView);
      setCurrentEntryId(snapshot.entryId);
      pendingScrollPositionRef.current = snapshot.scrollPosition;
      setView(snapshot.location.view);
    },
    [],
  );

  const closeSecondaryView = useCallback(() => {
    const result = popNavigationSnapshot(navigationHistory);
    setNavigationHistory(result.history);
    if (result.snapshot) restoreSnapshot(result.snapshot);
    else {
      setActivePrimaryView("home");
      beginNavigationEntry();
      pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
      setView("home");
    }
  }, [beginNavigationEntry, navigationHistory, restoreSnapshot]);

  const navigatePrimary = useCallback(
    (target: PrimaryNavigationView) => {
      if (target === activePrimaryView) {
        const origin = takePrimaryOriginSnapshot(navigationHistory, target);
        if (origin) {
          setNavigationHistory([]);
          restoreSnapshot(origin);
          return;
        }
      }
      setNavigationHistory([]);
      setActivePrimaryView(target);
      setSelectedPostId(null);
      setSelectedAssetId(null);
      setSelectedUserId(null);
      beginNavigationEntry();
      pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
      setView(target);
    },
    [
      activePrimaryView,
      beginNavigationEntry,
      navigationHistory,
      restoreSnapshot,
    ],
  );

  useEffect(() => {
    services.primeWorldService.configureSession(auth.user?.id);
  }, [auth.user?.id, services.primeWorldService]);

  useEffect(() => {
    if (
      auth.authLinkParams.resetToken ||
      auth.authLinkParams.verificationToken
    ) {
      setView("auth");
    }
  }, [auth.authLinkParams.resetToken, auth.authLinkParams.verificationToken]);

  useEffect(() => {
    if (!auth.user) {
      setSelectedAgent(null);
      setEditingPublicAsset(null);
      return;
    }
    const error = agentsQuery.error;
    if (error instanceof Error && error.message === "请重新登录。") {
      void auth.signOut().then(() => setView("auth"));
    }
  }, [agentsQuery.error, auth]);

  useEffect(() => {
    if (!auth.user) return;
    void runtime.message.startRealtime();
    const unsubscribeMute = runtime.message.onConversationAgentMuteChanged(
      (event) => {
        const updateAgent = (agent: Agent) =>
          agent.conversationId === event.conversationId &&
          agent.type === "prime-figure"
            ? withPrimeFigureMute(agent, event.muteUntilMs)
            : agent;
        setMyAgents((current) => current.map(updateAgent));
        setSelectedAgent((current) =>
          current ? updateAgent(current) : current,
        );
      },
    );
    const unsubscribeSync = runtime.message.onSyncChange((change) => {
      if (change.entityType === "agent") {
        if (change.operation === "delete") {
          setMyAgents((current) =>
            current.filter((agent) => agent.id !== change.entityId),
          );
          setSelectedAgent((current) =>
            current?.id === change.entityId ? null : current,
          );
          return;
        }
        if (change.entity?.entityType !== "agent") return;
        const agent = change.entity.value;
        setMyAgents((current) => [
          agent,
          ...current.filter((item) => item.id !== agent.id),
        ]);
        setSelectedAgent((current) =>
          current?.id === agent.id ? agent : current,
        );
      }
      if (change.entityType === "asset") {
        if (change.operation === "delete")
          setPublicAssets((current) =>
            current.filter((asset) => asset.id !== change.entityId),
          );
        else if (change.entity?.entityType === "asset") {
          const asset = change.entity.value;
          setPublicAssets((current) => [
            asset,
            ...current.filter((item) => item.id !== asset.id),
          ]);
        }
      }
    });
    const unsubscribeReset = runtime.message.onSyncReset(() => {
      setMyAgents([]);
      setPublicAssets([]);
      setSelectedAgent(null);
    });
    return () => {
      unsubscribeMute();
      unsubscribeSync();
      unsubscribeReset();
      void runtime.message.stopRealtime();
    };
  }, [auth.user?.id, runtime.message]);

  useEffect(() => {
    if (!auth.user) return;
    void services.agentService.cacheAgents(auth.user.id, myAgents);
  }, [auth.user, myAgents, services.agentService]);

  const openAgent = useCallback(
    (agent: Agent) => {
      notificationCenter.markConversationRead(agent.conversationId);
      setNavigationHistory([]);
      setActivePrimaryView("messages");
      setSelectedAgent(agent);
      beginNavigationEntry();
      setView("messages");
    },
    [beginNavigationEntry, notificationCenter.markConversationRead],
  );

  const handleAgentInstalled = useCallback((agent: Agent) => {
    setMyAgents((current) => [
      agent,
      ...current.filter((item) => item.id !== agent.id),
    ]);
  }, []);

  const openConversationList = useCallback(() => {
    setNavigationHistory([]);
    setActivePrimaryView("messages");
    setSelectedAgent(null);
    beginNavigationEntry();
    setView("messages");
  }, [beginNavigationEntry]);

  const closeConversation = useCallback(() => {
    setSelectedAgent(null);
    setView("messages");
  }, []);

  const openSettings = useCallback(() => {
    setNavigationHistory((current) =>
      pushNavigationSnapshot(current, createCurrentSnapshot()),
    );
    pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
    beginNavigationEntry();
    setView("settings");
  }, [beginNavigationEntry, createCurrentSnapshot]);

  const closeSettings = useCallback(() => {
    const result = popNavigationSnapshot(navigationHistory);
    setNavigationHistory(result.history);
    if (result.snapshot) restoreSnapshot(result.snapshot);
    else navigatePrimary("profile");
  }, [navigatePrimary, navigationHistory, restoreSnapshot]);

  const openBindings = useCallback(() => {
    if (view === "bindings") return;
    setBindingsReturnView(view);
    setView("bindings");
  }, [view]);

  const closeBindings = useCallback(() => {
    setView(bindingsReturnView);
  }, [bindingsReturnView]);

  const appBackAction = resolveAppBackAction(view, Boolean(selectedAgent));
  useBackHandler(
    () => {
      if (appBackAction === "close-conversation") closeConversation();
      else if (appBackAction === "close-bindings") closeBindings();
      else if (appBackAction === "close-settings") closeSettings();
      else if (appBackAction === "close-secondary") closeSecondaryView();
    },
    { enabled: appBackAction !== null },
  );

  const handleConversationDeleted = useCallback(
    (conversationId: string) => {
      setMyAgents((current) =>
        current.filter((agent) => agent.conversationId !== conversationId),
      );
      setSelectedAgent((current) =>
        current?.conversationId === conversationId ? null : current,
      );
      setNavigationHistory([]);
      setActivePrimaryView("home");
      beginNavigationEntry();
      setView("home");
    },
    [beginNavigationEntry],
  );

  const createSliceFigure = async (input: CreateSliceFigureRequest) => {
    try {
      const created = await services.agentService.createSliceFigure(input);
      const agent = created.agent;
      setMyAgents((current) => [
        agent,
        ...current.filter((item) => item.id !== agent.id),
      ]);
      openAgent(agent);
      return agent;
    } catch (error) {
      if (error instanceof Error && error.message === "请重新登录。") {
        await auth.signOut();
        setView("auth");
      }
      throw error;
    }
  };

  const createPrimeFigure = async (input: CreatePrimeFigureRequest) => {
    try {
      const created = await services.agentService.createPrimeFigure(input);
      const agent = created.agent;
      setMyAgents((current) => [
        agent,
        ...current.filter((item) => item.id !== agent.id),
      ]);
      openAgent(agent);
      return agent;
    } catch (error) {
      if (error instanceof Error && error.message === "请重新登录。") {
        await auth.signOut();
        setView("auth");
      }
      throw error;
    }
  };

  const createPrimeWorld = async (input: CreatePrimeWorldRequest) => {
    const created = await services.agentService.createPrimeWorld(input);
    const agent = created.agent;
    setMyAgents((current) => [
      agent,
      ...current.filter((item) => item.id !== agent.id),
    ]);
    openAgent(agent);
    return agent;
  };

  const updatePrimeWorld = async (
    agentId: string,
    input: UpdatePrimeWorldRequest,
  ) => {
    const updated = await services.agentService.updatePrimeWorld(
      agentId,
      input,
    );
    const agent = updated.agent;
    setMyAgents((current) =>
      current.map((item) => (item.id === agent.id ? agent : item)),
    );
    setSelectedAgent((current) => (current?.id === agent.id ? agent : current));
    return agent;
  };

  const updateSliceFigure = async (
    agentId: string,
    input: UpdateSliceFigureRequest,
  ) => {
    try {
      const updated = await services.agentService.updateSliceFigure(
        agentId,
        input,
      );
      const agent = updated.agent;
      setMyAgents((current) =>
        current.map((item) => (item.id === agent.id ? agent : item)),
      );
      setSelectedAgent((current) =>
        current?.id === agent.id ? agent : current,
      );
      return agent;
    } catch (error) {
      if (error instanceof Error && error.message === "请重新登录。") {
        await auth.signOut();
        setView("auth");
      }
      throw error;
    }
  };

  const updatePrimeFigure = async (
    agentId: string,
    input: UpdatePrimeFigureRequest,
  ) => {
    try {
      const updated = await services.agentService.updatePrimeFigure(
        agentId,
        input,
      );
      const agent = updated.agent;
      setMyAgents((current) =>
        current.map((item) => (item.id === agent.id ? agent : item)),
      );
      setSelectedAgent((current) =>
        current?.id === agent.id ? agent : current,
      );
      return agent;
    } catch (error) {
      if (error instanceof Error && error.message === "请重新登录。") {
        await auth.signOut();
        setView("auth");
      }
      throw error;
    }
  };

  const addPrimeFigureSticker = async (
    agentId: string,
    input: AddPrimeFigureStickerRequest,
  ) => {
    const { agent } = await services.agentService.addPrimeFigureSticker(
      agentId,
      input,
    );
    setMyAgents((current) =>
      current.map((item) => (item.id === agent.id ? agent : item)),
    );
    setSelectedAgent((current) => (current?.id === agent.id ? agent : current));
    return agent;
  };

  const deletePrimeFigureSticker = async (
    agentId: string,
    stickerId: string,
  ) => {
    const { agent } = await services.agentService.deletePrimeFigureSticker(
      agentId,
      stickerId,
    );
    setMyAgents((current) =>
      current.map((item) => (item.id === agent.id ? agent : item)),
    );
    setSelectedAgent((current) => (current?.id === agent.id ? agent : current));
    return agent;
  };

  const createOrOpenPublicDraft = async (
    input: CreatePublicAssetDraftRequest,
  ) => {
    const snapshot = createCurrentSnapshot();
    const draft = await services.publicAssetService.createDraft(input);
    setPublicAssets((current) => [
      draft,
      ...current.filter((item) => item.id !== draft.id),
    ]);
    setNavigationHistory((current) =>
      pushNavigationSnapshot(current, snapshot),
    );
    setEditingPublicAsset(draft);
    pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
    beginNavigationEntry();
    setView("public-editor");
  };

  const openPost = (postId: string) => {
    if (view === "post-detail" && selectedPostId === postId) return;
    rememberCurrentLocation();
    setSelectedPostId(postId);
    beginNavigationEntry();
    setView("post-detail");
  };
  const openAsset = (assetId: string) => {
    if (view === "character-detail" && selectedAssetId === assetId) return;
    rememberCurrentLocation();
    setSelectedAssetId(assetId);
    beginNavigationEntry();
    setView("character-detail");
  };
  const openPublicProfile = (userId: string) => {
    rememberCurrentLocation();
    setSelectedUserId(userId);
    beginNavigationEntry();
    setView("public-profile");
  };
  function rememberCurrentLocation() {
    setNavigationHistory((current) =>
      pushNavigationSnapshot(current, createCurrentSnapshot()),
    );
    pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
  }
  const closeDetail = closeSecondaryView;

  const renderPage = (location: ViewLocation) => {
    const pageView = location.view;
    const pageProtected = isProtectedView(pageView);
    if (auth.isLoading) {
      return (
        <div className="grid min-h-[calc(100dvh-8rem)] place-items-center">
          <div className="glass-panel rounded-full px-5 py-3 text-sm text-white/70">
            正在检查登录状态
          </div>
        </div>
      );
    }
    if (pageView === "auth" || (pageProtected && !auth.user)) {
      return (
        <AuthPage
          onAuthenticated={() =>
            setView(pageView === "auth" ? "messages" : pageView)
          }
        />
      );
    }
    if (pageView === "post-detail" && location.postId)
      return (
        <PostDetailPage
          postId={location.postId}
          service={services.socialService}
          isAuthenticated={Boolean(auth.user)}
          onRequireAuth={() => setView("auth")}
          onBack={closeDetail}
          onOpenUser={openPublicProfile}
          onOpenPost={openPost}
          onOpenAsset={openAsset}
          onDeleted={closeDetail}
          viewerId={auth.user?.id ?? "anonymous"}
        />
      );
    if (pageView === "character-detail" && location.assetId)
      return (
        <CharacterDetailPage
          assetId={location.assetId}
          characterService={services.publicAssetService}
          socialService={services.socialService}
          isAuthenticated={Boolean(auth.user)}
          onRequireAuth={() => setView("auth")}
          onBack={closeDetail}
          onOpenUser={openPublicProfile}
          onOpenPost={openPost}
          onOpenAsset={openAsset}
          onAgentInstalled={handleAgentInstalled}
          viewerId={auth.user?.id ?? "anonymous"}
        />
      );
    if (pageView === "public-profile" && location.userId)
      return (
        <PublicProfilePage
          userId={location.userId}
          onBack={closeDetail}
          onOpenPost={openPost}
          onOpenAsset={openAsset}
          onOpenUser={openPublicProfile}
          onRequireAuth={() => setView("auth")}
          refreshVersion={notificationCenter.activityRefreshVersion}
        />
      );
    if (pageView === "explore")
      return (
        <ExplorePage
          onOpenPost={openPost}
          onOpenAsset={openAsset}
          onOpenUser={openPublicProfile}
          onAgentInstalled={handleAgentInstalled}
          onRequireAuth={() => setView("auth")}
          refreshVersion={notificationCenter.activityRefreshVersion}
        />
      );
    if (pageView === "public-editor" && editingPublicAsset)
      return (
        <PublicAssetEditorPage
          draft={editingPublicAsset}
          service={services.publicAssetService}
          onBack={closeSecondaryView}
          onDeleted={() => {
            setPublicAssets((current) =>
              current.filter((asset) => asset.id !== editingPublicAsset.id),
            );
            setEditingPublicAsset(null);
            closeSecondaryView();
          }}
          onDraftChange={(next) => {
            setEditingPublicAsset(next);
            setPublicAssets((current) =>
              current.map((asset) => (asset.id === next.id ? next : asset)),
            );
          }}
        />
      );
    if (pageView === "profile")
      return (
        <ProfilePage
          agents={myAgents}
          isLoadingAgents={isLoadingAgents}
          onOpenAgent={openAgent}
          onOpenSettings={openSettings}
          publicAssets={publicAssets}
          onCreatePublicDraft={createOrOpenPublicDraft}
          onManagePublicAsset={(asset) => {
            setNavigationHistory((current) =>
              pushNavigationSnapshot(current, createCurrentSnapshot()),
            );
            setEditingPublicAsset(asset);
            pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
            beginNavigationEntry();
            setView("public-editor");
          }}
          onOpenAsset={openAsset}
          onOpenPost={openPost}
          onOpenUser={openPublicProfile}
        />
      );
    if (pageView === "create")
      return (
        <CreateAgentPage
          primeWorldService={services.primeWorldService}
          createHandlers={{
            "slice-figure": createSliceFigure,
            "prime-figure": createPrimeFigure,
            "prime-world": createPrimeWorld,
          }}
          importPrimeWorld={async (bundle) => {
            const created =
              await services.primeWorldService.importBundle(bundle);
            const agent = created.agent;
            setMyAgents((current) => [
              agent,
              ...current.filter((item) => item.id !== agent.id),
            ]);
            openAgent(agent);
            return agent;
          }}
          onBack={closeSecondaryView}
        />
      );
    if (pageView === "messages") {
      if (selectedAgent?.type === "prime-world")
        return (
          <PrimeWorldPage
            agent={selectedAgent}
            service={services.primeWorldService}
            onBack={closeConversation}
            onDelete={async (conversationId) => {
              await services.messageService.deleteConversation(conversationId);
              handleConversationDeleted(conversationId);
            }}
            onSave={async (detail, preserveRuntimeState) => {
              await updatePrimeWorld(selectedAgent.id, {
                name: selectedAgent.name,
                attributes: selectedAgent.attributes,
                tags: selectedAgent.tags,
                introduction: selectedAgent.introduction,
                isPublic: selectedAgent.isPublic,
                detail,
                preserveRuntimeState,
              });
            }}
          />
        );
      return (
        <MessagesPage
          agent={selectedAgent ?? undefined}
          updateHandlers={{
            "slice-figure": updateSliceFigure,
            "prime-figure": updatePrimeFigure,
            addPrimeFigureSticker,
            deletePrimeFigureSticker,
            getPrimeFigureEditSnapshot: (agentId) =>
              services.agentService.getPrimeFigureEditSnapshot(agentId),
            exportAgent: (agentId) =>
              services.agentService.exportAgent(agentId),
            getConversationRuntimeConfig: (conversationId) =>
              services.runtimeConfigService.getConversationConfig(
                conversationId,
              ),
            updateConversationRuntimeConfig: (conversationId, patch) =>
              services.runtimeConfigService.updateConversationConfig(
                conversationId,
                patch,
              ),
          }}
          onConversationDeleted={handleConversationDeleted}
          onBack={closeConversation}
        />
      );
    }
    if (pageView === "bindings")
      return (
        <BindingsPanel
          onBack={closeBindings}
          agents={myAgents}
          channelsApi={services.channelsApi}
        />
      );
    if (pageView === "settings")
      return (
        <SettingsPage
          runtimeConfigService={services.runtimeConfigService}
          rewardsService={services.rewardsService}
          rechargeService={services.rechargeService}
          onBack={closeSettings}
          notificationPermission={{
            state: notificationCenter.permissionState,
            request: notificationCenter.requestPermission,
            openSettings: notificationCenter.openNotificationSettings,
          }}
        />
      );
    return (
      <HomePage
        service={services.publicAssetService}
        isAuthenticated={Boolean(auth.user)}
        onCreateAgent={() => {
          setNavigationHistory((current) =>
            pushNavigationSnapshot(current, createCurrentSnapshot()),
          );
          pendingScrollPositionRef.current = { mainTop: 0, windowTop: 0 };
          beginNavigationEntry();
          setView("create");
        }}
        onAgentInstalled={handleAgentInstalled}
        onRequireAuth={() => setView("auth")}
        onOpenAsset={openAsset}
        onOpenUser={openPublicProfile}
      />
    );
  };

  const activeLocation = currentLocation();
  const navigationLayers: NavigationEntry<ViewLocation>[] = [
    ...navigationHistory,
    {
      entryId: currentEntryId,
      location: activeLocation,
      primaryView: activePrimaryView,
      scrollPosition: captureScrollPosition(),
    },
  ];

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#09090b] text-[#e5e2e1]">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute left-[7%] top-[8%] h-80 w-80 rounded-full bg-white/[0.045] blur-[110px]" />
        <div className="absolute bottom-[4%] right-[3%] h-[30rem] w-[30rem] rounded-full bg-white/[0.035] blur-[150px]" />
      </div>

      <div
        className={`relative z-10 grid max-w-none grid-cols-1 md:gap-4 md:px-4 md:pb-6 md:pt-6 ${
          isMobileChatFullscreen
            ? "px-0 pb-0 pt-0"
            : `px-5 pt-[max(1.25rem,env(safe-area-inset-top))] ${showMobileBottomNav ? "pb-28" : "pb-5"}`
        } md:h-[100dvh] md:min-h-0 ${isViewportPanel ? "h-[100dvh] min-h-0" : "min-h-[100dvh]"} ${
          showConversationRail
            ? "md:grid-cols-[64px_280px_minmax(0,1fr)]"
            : "md:grid-cols-[64px_1fr]"
        }`}
      >
        <aside className="hidden md:block">
          <nav className="glass-panel sticky top-6 flex flex-col items-center gap-2 rounded-xl p-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeNavView === item.id;
              const unread =
                item.id === "messages"
                  ? notificationCenter.hasUnreadMessages
                  : item.id === "explore"
                    ? notificationCenter.notificationState.activityUnread
                    : false;
              return (
                <button
                  key={item.id}
                  aria-label={`${item.label}${unread ? "，有新内容" : ""}`}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-lg transition active:translate-y-px ${
                    active
                      ? "bg-white text-[#09090b] luminous-ring"
                      : "text-white/50 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  onClick={() => navigatePrimary(item.id)}
                >
                  <Icon size={22} weight={active ? "fill" : "regular"} />
                  {unread ? <UnreadDot /> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        {showConversationRail ? (
          <ConversationRail
            agents={myAgents}
            conversations={notificationCenter.conversations}
            selectedAgentId={
              view === "messages" ? selectedAgent?.id : undefined
            }
            isBindingsActive={view === "bindings"}
            onOpenAgent={openAgent}
            onOpenBindings={openBindings}
            onOpenChat={openConversationList}
          />
        ) : null}

        {showMobileConversationList ? (
          <ConversationRail
            agents={myAgents}
            conversations={notificationCenter.conversations}
            selectedAgentId={
              view === "messages" ? selectedAgent?.id : undefined
            }
            layout="mobile"
            isBindingsActive={view === "bindings"}
            onOpenAgent={openAgent}
            onOpenBindings={openBindings}
            onOpenChat={openConversationList}
          />
        ) : null}

        <main
          ref={mainRef}
          className={`w-full min-w-0 md:min-h-0 md:overflow-y-auto md:pr-4 ${isViewportPanel ? "min-h-0 overflow-hidden md:overflow-hidden" : ""} ${
            showMobileConversationList ? "hidden md:block" : ""
          }`}
        >
          {navigationLayers.map((entry, index) => {
            const active = index === navigationLayers.length - 1;
            return (
              <NavigationLayer key={entry.entryId} active={active}>
                {renderPage(entry.location)}
              </NavigationLayer>
            );
          })}
        </main>
      </div>

      {showMobileBottomNav ? (
        <nav className="app-mobile-bottom-nav fixed bottom-6 left-1/2 z-50 flex h-16 w-[calc(100%-40px)] max-w-md -translate-x-1/2 items-center justify-around rounded-full border border-white/10 bg-[#09090b]/50 px-3 backdrop-blur-2xl shadow-[0_0_60px_rgba(255,255,255,0.10)] md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNavView === item.id;
            const unread =
              item.id === "messages"
                ? notificationCenter.hasUnreadMessages
                : item.id === "explore"
                  ? notificationCenter.notificationState.activityUnread
                  : false;
            return (
              <button
                key={item.id}
                aria-label={`${item.label}${unread ? "，有新内容" : ""}`}
                className={`relative flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                  active
                    ? "bg-white text-[#09090b]"
                    : "text-white/55 hover:text-white"
                }`}
                onClick={() =>
                  item.id === "messages"
                    ? openConversationList()
                    : navigatePrimary(item.id)
                }
              >
                <Icon size={22} weight={active ? "fill" : "regular"} />
                {unread ? <UnreadDot /> : null}
              </button>
            );
          })}
        </nav>
      ) : null}
      {notificationCenter.shouldPromptPermission ? (
        <NotificationPermissionPrompt
          onEnable={async () => {
            if (await notificationCenter.requestPermission())
              notificationCenter.dismissPrompt();
          }}
          onDismiss={notificationCenter.dismissPrompt}
        />
      ) : null}
    </div>
  );
}

function UnreadDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#0d0d10] bg-[#ff5b63]"
    />
  );
}

function withPrimeFigureMute(
  agent: Extract<Agent, { type: "prime-figure" }>,
  muteUntilMs: number | null,
): Agent {
  const { muteUntilMs: _previousMuteUntilMs, ...rest } = agent;
  return muteUntilMs && muteUntilMs > Date.now()
    ? { ...rest, muteUntilMs }
    : rest;
}

function resolveStateUpdate<T>(update: SetStateAction<T>, current: T): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

function isProtectedView(view: AppView) {
  return (
    view === "messages" ||
    view === "bindings" ||
    view === "settings" ||
    view === "profile" ||
    view === "create" ||
    view === "public-editor"
  );
}
