import {
  ChatCircleText,
  Compass,
  House,
  UserCircle,
} from "@phosphor-icons/react";
import type {
  Agent,
  CharacterAssetDraft,
  CreateCharacterAssetDraftRequest,
  AddPrimeFigureStickerRequest,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
} from "@echoo/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import { useServices } from "./providers/ServicesProvider";
import { useAuth } from "./providers/AuthProvider";
import { useRuntime } from "./providers/RuntimeProvider";
import { BindingsPanel } from "../features/bindings/components/BindingsPanel";
import { ConversationRail } from "../features/conversations/components/ConversationRail";
import { AuthPage } from "../pages/auth/AuthPage";
import { CreateAgentPage } from "../pages/create-agent/CreateAgentPage";
import { ExplorePage } from "../pages/explore/ExplorePage";
import { HomePage } from "../pages/home/HomePage";
import { MessagesPage } from "../pages/messages/MessagesPage";
import { ProfilePage } from "../pages/profile/ProfilePage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { PublicAssetEditorPage } from "../pages/public-asset/PublicAssetEditorPage";
import {
  getActivePrimaryNavigationView,
  PRIMARY_NAVIGATION_VIEWS,
  type PrimaryNavigationView,
  shouldShowDesktopConversationRail,
  shouldShowMobileBottomNav,
  shouldShowMobileConversationList,
} from "./navigationPresentation";

type AppView =
  | "home"
  | "messages"
  | "bindings"
  | "settings"
  | "explore"
  | "profile"
  | "create"
  | "public-editor"
  | "auth";

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
  const [view, setView] = useState<AppView>("home");
  const [bindingsReturnView, setBindingsReturnView] =
    useState<AppView>("messages");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [editingPublicAsset, setEditingPublicAsset] =
    useState<CharacterAssetDraft | null>(null);
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
    queryFn: () => services.agentService.listMyAgents(),
    enabled: Boolean(auth.user),
    staleTime: Infinity,
  });
  const assetsQuery = useQuery({
    queryKey: assetQueryKey,
    queryFn: () => services.characterAssetService.listMine(),
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
    (update: SetStateAction<CharacterAssetDraft[]>) =>
      queryClient.setQueryData<CharacterAssetDraft[]>(
        assetQueryKey,
        (current = []) => resolveStateUpdate(update, current),
      ),
    [assetQueryKey, queryClient],
  );
  const protectedView =
    view === "messages" ||
    view === "bindings" ||
    view === "settings" ||
    view === "profile" ||
    view === "create" ||
    view === "public-editor";
  const showConversationRail = shouldShowDesktopConversationRail(
    view,
    !!auth.user,
  );
  const activeNavView = getActivePrimaryNavigationView(
    view,
    bindingsReturnView,
  );
  const isViewportPanel = view === "messages" || view === "bindings";
  const showMobileBottomNav = shouldShowMobileBottomNav(
    view,
    !!selectedAgent,
    !!auth.user,
  );
  const showMobileConversationList =
    !!auth.user && shouldShowMobileConversationList(view, !!selectedAgent);

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
  }, [auth.user, runtime.message]);

  const openAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
    setView("messages");
  }, []);

  const handleAgentInstalled = useCallback((agent: Agent) => {
    setMyAgents((current) => [
      agent,
      ...current.filter((item) => item.id !== agent.id),
    ]);
  }, []);

  const openConversationList = useCallback(() => {
    setSelectedAgent(null);
    setView("messages");
  }, []);

  const closeConversation = useCallback(() => {
    setSelectedAgent(null);
    setView("messages");
  }, []);

  const openSettings = useCallback(() => {
    setView("settings");
  }, []);

  const closeSettings = useCallback(() => {
    setView("profile");
  }, []);

  const openBindings = useCallback(() => {
    if (view === "bindings") return;
    setBindingsReturnView(view);
    setView("bindings");
  }, [view]);

  const closeBindings = useCallback(() => {
    setView(bindingsReturnView);
  }, [bindingsReturnView]);

  const handleConversationDeleted = useCallback((conversationId: string) => {
    setMyAgents((current) =>
      current.filter((agent) => agent.conversationId !== conversationId),
    );
    setSelectedAgent((current) =>
      current?.conversationId === conversationId ? null : current,
    );
    setView("home");
  }, []);

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
    input: CreateCharacterAssetDraftRequest,
  ) => {
    const draft = await services.characterAssetService.createDraft(input);
    setPublicAssets((current) => [
      draft,
      ...current.filter((item) => item.id !== draft.id),
    ]);
    setEditingPublicAsset(draft);
    setView("public-editor");
  };

  const ActivePage = useMemo(() => {
    if (auth.isLoading) {
      return (
        <div className="grid min-h-[calc(100dvh-8rem)] place-items-center">
          <div className="glass-panel rounded-full px-5 py-3 text-sm text-white/70">
            正在检查登录状态
          </div>
        </div>
      );
    }
    if (view === "auth" || (protectedView && !auth.user)) {
      return (
        <AuthPage
          onAuthenticated={() => setView(view === "auth" ? "messages" : view)}
        />
      );
    }
    if (view === "explore") return <ExplorePage />;
    if (view === "public-editor" && editingPublicAsset)
      return (
        <PublicAssetEditorPage
          draft={editingPublicAsset}
          service={services.characterAssetService}
          onBack={() => setView("profile")}
          onDeleted={() => {
            setPublicAssets((current) =>
              current.filter((asset) => asset.id !== editingPublicAsset.id),
            );
            setEditingPublicAsset(null);
            setView("profile");
          }}
          onDraftChange={(next) => {
            setEditingPublicAsset(next);
            setPublicAssets((current) =>
              current.map((asset) => (asset.id === next.id ? next : asset)),
            );
          }}
        />
      );
    if (view === "profile")
      return (
        <ProfilePage
          agents={myAgents}
          isLoadingAgents={isLoadingAgents}
          onOpenAgent={openAgent}
          onOpenSettings={openSettings}
          publicAssets={publicAssets}
          onCreatePublicDraft={createOrOpenPublicDraft}
          onManagePublicAsset={(asset) => {
            setEditingPublicAsset(asset);
            setView("public-editor");
          }}
        />
      );
    if (view === "create")
      return (
        <CreateAgentPage
          createHandlers={{
            "slice-figure": createSliceFigure,
            "prime-figure": createPrimeFigure,
          }}
        />
      );
    if (view === "messages") {
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
    if (view === "bindings") return <BindingsPanel onBack={closeBindings} />;
    if (view === "settings")
      return (
        <SettingsPage
          runtimeConfigService={services.runtimeConfigService}
          onBack={closeSettings}
        />
      );
    return (
      <HomePage
        service={services.characterAssetService}
        isAuthenticated={Boolean(auth.user)}
        onCreateAgent={() => setView("create")}
        onAgentInstalled={handleAgentInstalled}
        onRequireAuth={() => setView("auth")}
      />
    );
  }, [
    auth.isLoading,
    auth.user,
    closeBindings,
    closeConversation,
    closeSettings,
    handleConversationDeleted,
    handleAgentInstalled,
    isLoadingAgents,
    myAgents,
    publicAssets,
    editingPublicAsset,
    openConversationList,
    openSettings,
    protectedView,
    selectedAgent,
    view,
  ]);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#09090b] text-[#e5e2e1]">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute left-[7%] top-[8%] h-80 w-80 rounded-full bg-white/[0.045] blur-[110px]" />
        <div className="absolute bottom-[4%] right-[3%] h-[30rem] w-[30rem] rounded-full bg-white/[0.035] blur-[150px]" />
      </div>

      <div
        className={`relative z-10 mx-auto grid max-w-[1440px] grid-cols-1 px-5 pt-5 md:gap-6 md:px-16 md:pb-6 md:pt-6 ${
          showMobileBottomNav ? "pb-28" : "pb-5"
        } ${isViewportPanel ? "h-[100dvh] min-h-0" : "min-h-[100dvh]"} ${
          showConversationRail
            ? "md:grid-cols-[64px_300px_1fr]"
            : "md:grid-cols-[64px_1fr]"
        }`}
      >
        <aside className="hidden md:block">
          <nav className="glass-panel sticky top-6 flex flex-col items-center gap-2 rounded-xl p-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeNavView === item.id;
              return (
                <button
                  key={item.id}
                  aria-label={item.label}
                  className={`flex h-11 w-11 items-center justify-center rounded-lg transition active:translate-y-px ${
                    active
                      ? "bg-white text-[#09090b] luminous-ring"
                      : "text-white/50 hover:bg-white/[0.06] hover:text-white"
                  }`}
                  onClick={() => setView(item.id)}
                >
                  <Icon size={22} weight={active ? "fill" : "regular"} />
                </button>
              );
            })}
          </nav>
        </aside>

        {showConversationRail ? (
          <ConversationRail
            agents={myAgents}
            isBindingsActive={view === "bindings"}
            onOpenAgent={openAgent}
            onOpenBindings={openBindings}
            onOpenChat={openConversationList}
          />
        ) : null}

        {showMobileConversationList ? (
          <ConversationRail
            agents={myAgents}
            layout="mobile"
            isBindingsActive={view === "bindings"}
            onOpenAgent={openAgent}
            onOpenBindings={openBindings}
            onOpenChat={openConversationList}
          />
        ) : null}

        <main
          className={`min-w-0 ${isViewportPanel ? "min-h-0 overflow-hidden" : ""} ${
            showMobileConversationList ? "hidden md:block" : ""
          }`}
        >
          {ActivePage}
        </main>
      </div>

      {showMobileBottomNav ? (
        <nav className="fixed bottom-6 left-1/2 z-50 flex h-16 w-[calc(100%-40px)] max-w-md -translate-x-1/2 items-center justify-around rounded-full border border-white/10 bg-[#09090b]/50 px-3 backdrop-blur-2xl shadow-[0_0_60px_rgba(255,255,255,0.10)] md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNavView === item.id;
            return (
              <button
                key={item.id}
                aria-label={item.label}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                  active
                    ? "bg-white text-[#09090b]"
                    : "text-white/55 hover:text-white"
                }`}
                onClick={() =>
                  item.id === "messages"
                    ? openConversationList()
                    : setView(item.id)
                }
              >
                <Icon size={22} weight={active ? "fill" : "regular"} />
              </button>
            );
          })}
        </nav>
      ) : null}
    </div>
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
