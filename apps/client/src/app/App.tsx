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
  CreateSliceFigureRequest,
  UpdatePrimeFigureRequest,
  UpdateSliceFigureRequest,
} from "@echoo/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { initApp } from "./bootstrap/initApp";
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
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [view, setView] = useState<AppView>("home");
  const [bindingsReturnView, setBindingsReturnView] =
    useState<AppView>("messages");
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const protectedView =
    view === "messages" ||
    view === "bindings" ||
    view === "settings" ||
    view === "profile" ||
    view === "create";
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
      setMyAgents([]);
      setSelectedAgent(null);
      return;
    }

    let cancelled = false;
    setIsLoadingAgents(true);
    void services.agentService
      .listMyAgents()
      .then((agents) => {
        if (!cancelled) setMyAgents(agents);
      })
      .catch(async (error) => {
        if (cancelled) return;
        if (error instanceof Error && error.message === "请重新登录。") {
          await auth.signOut();
          setView("auth");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAgents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.user, services.agentService]);

  useEffect(() => {
    if (!auth.user) return;
    void runtime.message.startRealtime();
    const unsubscribe = runtime.message.onConversationAgentMuteChanged(
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
    return () => {
      unsubscribe();
      void runtime.message.stopRealtime();
    };
  }, [auth.user, runtime.message]);

  const openAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
    setView("messages");
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
      const { agent } = await services.agentService.createSliceFigure(input);
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
      const { agent } = await services.agentService.createPrimeFigure(input);
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
      const { agent } = await services.agentService.updateSliceFigure(
        agentId,
        input,
      );
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
      const { agent } = await services.agentService.updatePrimeFigure(
        agentId,
        input,
      );
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
    if (view === "profile")
      return (
        <ProfilePage
          agents={myAgents}
          isLoadingAgents={isLoadingAgents}
          onOpenAgent={openAgent}
          onOpenSettings={openSettings}
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
        onCreateAgent={() => setView("create")}
        onOpenChat={openConversationList}
      />
    );
  }, [
    auth.isLoading,
    auth.user,
    closeBindings,
    closeConversation,
    closeSettings,
    handleConversationDeleted,
    isLoadingAgents,
    myAgents,
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
