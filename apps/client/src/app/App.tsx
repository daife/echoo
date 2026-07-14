import {
  ChatCircleText,
  Compass,
  GearSix,
  House,
  LinkSimple,
  UserCircle,
} from "@phosphor-icons/react";
import type {
  Agent,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
  UpdatePrimeFigurePreferencesRequest,
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

type AppView =
  | "home"
  | "messages"
  | "bindings"
  | "settings"
  | "explore"
  | "profile"
  | "create"
  | "auth";

const navItems = [
  { id: "home", label: "首页", icon: House },
  { id: "messages", label: "聊天", icon: ChatCircleText },
  { id: "bindings", label: "绑定", icon: LinkSimple },
  { id: "settings", label: "设置", icon: GearSix },
] satisfies { id: AppView; label: string; icon: typeof House }[];

export function App() {
  const auth = useAuth();
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  const [view, setView] = useState<AppView>("home");
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const protectedView =
    view === "messages" ||
    view === "bindings" ||
    view === "settings" ||
    view === "profile" ||
    view === "create";
  const showConversationRail =
    (view === "home" ||
      view === "messages" ||
      view === "bindings" ||
      view === "settings") &&
    (!protectedView || !!auth.user);

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

  const openAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setView("messages");
  };

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

  const updatePrimeFigurePreferences = async (
    agentId: string,
    input: UpdatePrimeFigurePreferencesRequest,
  ) => {
    try {
      const { agent } =
        await services.agentService.updatePrimeFigurePreferences(
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
            updatePrimeFigurePreferences,
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
        />
      );
    }
    if (view === "bindings") return <BindingsPanel />;
    if (view === "settings")
      return (
        <SettingsPage runtimeConfigService={services.runtimeConfigService} />
      );
    return (
      <HomePage
        onCreateAgent={() => setView("create")}
        onOpenChat={() => setView("messages")}
      />
    );
  }, [
    auth.isLoading,
    auth.user,
    handleConversationDeleted,
    isLoadingAgents,
    myAgents,
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

      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#09090b]/78 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-16">
          <button
            aria-label="探索"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/55 transition hover:bg-white/[0.05] hover:text-white active:translate-y-px"
            onClick={() => setView("explore")}
          >
            <Compass size={20} weight="duotone" />
          </button>
          <div className="text-sm font-semibold tracking-[0.24em] text-white">
            ECHOO <span className="text-white/35">/</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label="个人资料"
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-white/55 transition hover:bg-white/[0.05] hover:text-white"
              onClick={() => setView(auth.user ? "profile" : "auth")}
            >
              <UserCircle size={24} weight="duotone" />
            </button>
          </div>
        </div>
      </header>

      <div
        className={`relative z-10 mx-auto grid max-w-[1440px] grid-cols-1 px-5 pb-28 pt-24 md:gap-6 md:px-16 md:pb-8 ${
          view === "messages" ? "h-[100dvh] min-h-0" : "min-h-[100dvh]"
        } ${
          showConversationRail
            ? "md:grid-cols-[64px_300px_1fr]"
            : "md:grid-cols-[64px_1fr]"
        }`}
      >
        <aside className="hidden md:block">
          <nav className="glass-panel sticky top-24 flex flex-col items-center gap-2 rounded-xl p-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
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
            onOpenAgent={openAgent}
            onOpenChat={() => setView("messages")}
          />
        ) : null}

        <main
          className={`min-w-0 ${view === "messages" ? "min-h-0 overflow-hidden" : ""}`}
        >
          {ActivePage}
        </main>
      </div>

      <nav className="fixed bottom-6 left-1/2 z-50 flex h-16 w-[calc(100%-40px)] max-w-md -translate-x-1/2 items-center justify-around rounded-full border border-white/10 bg-[#09090b]/50 px-3 backdrop-blur-2xl shadow-[0_0_60px_rgba(255,255,255,0.10)] md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              aria-label={item.label}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 ${
                active
                  ? "bg-white text-[#09090b]"
                  : "text-white/55 hover:text-white"
              }`}
              onClick={() => setView(item.id)}
            >
              <Icon size={22} weight={active ? "fill" : "regular"} />
            </button>
          );
        })}
      </nav>
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
