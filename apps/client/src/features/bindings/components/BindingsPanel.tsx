import { Link, Trash, WechatLogo } from "@phosphor-icons/react";
import type { Agent } from "@echoo/shared";
import type { ChannelsApi } from "@echoo/api-client";
import { useEffect, useMemo, useState } from "react";
import { BackButton } from "../../../shared/components/BackButton";

export function BindingsPanel({
  onBack,
  agents,
  channelsApi,
}: {
  onBack: () => void;
  agents: Agent[];
  channelsApi: ChannelsApi;
}) {
  const [binding, setBinding] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const figureAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.type === "slice-figure" || agent.type === "prime-figure",
      ),
    [agents],
  );
  const load = () =>
    channelsApi
      .getWechatBinding()
      .then((value) => {
        setBinding(value.binding);
        if (value.binding)
          setSelectedConversationId(value.binding.conversationId);
      })
      .catch(() => setBinding(null));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (
      !attempt?.attemptId ||
      attempt.status === "connected" ||
      attempt.status === "expired"
    )
      return;
    const timer = window.setInterval(
      () =>
        channelsApi.pollWechatLogin(attempt.attemptId).then((next) => {
          setAttempt(next);
          if (next.binding) {
            setBinding(next.binding);
            setAttempt(null);
          }
        }),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [attempt?.attemptId, attempt?.status]);
  const start = async () => {
    if (!selectedConversationId) return;
    setBusy(true);
    try {
      const next = await channelsApi.startWechatLogin(selectedConversationId);
      setAttempt(next);
    } catch (error) {
      if (
        binding &&
        window.confirm("微信已经绑定其他角色，是否切换到当前角色？")
      ) {
        const next = await channelsApi.rebindWechat(selectedConversationId);
        setBinding(next.binding);
      } else
        window.alert(
          error instanceof Error ? error.message : "无法开始微信绑定。",
        );
    } finally {
      setBusy(false);
    }
  };
  const unbind = async () => {
    if (!window.confirm("确定解绑微信接口吗？")) return;
    setBusy(true);
    try {
      await channelsApi.unbindWechat();
      setBinding(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="h-full min-h-0 overflow-y-auto rounded-2xl border border-white/8 bg-[#0d0d10]/80 p-4 md:p-8">
      <div className="w-full max-w-2xl">
        <header className="flex items-center gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight text-white md:text-4xl">
              角色接口
            </h1>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-white/38">
              绑定
            </p>
          </div>
        </header>
        <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.025] p-4 md:mt-8 md:p-6">
            <div className="flex items-center gap-3">
              <WechatLogo size={28} className="text-emerald-300" />
              <div>
                <h2 className="text-lg font-medium text-white">微信</h2>
                <p className="text-sm text-white/48">
                  一个微信接口只能绑定一个角色会话。
                </p>
              </div>
            </div>
            <label className="mt-6 block text-sm text-white/60">
              选择角色会话
              <select
                value={selectedConversationId}
                onChange={(event) =>
                  setSelectedConversationId(event.target.value)
                }
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              >
                <option value="">请选择</option>
                {figureAgents.map((agent) => (
                  <option key={agent.id} value={agent.conversationId}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            {binding && (
              <p className="mt-4 text-sm text-emerald-200">
                当前已绑定：
                {figureAgents.find(
                  (agent) => agent.conversationId === binding.conversationId,
                )?.name ?? binding.conversationId}
              </p>
            )}
            {attempt?.qrcodeUrl && (
              <div className="mt-5 flex flex-col items-center gap-3">
                <img
                  src={attempt.qrcodeUrl}
                  alt="微信登录二维码"
                  className="h-52 w-52 bg-white p-2"
                />
                <p className="text-sm text-white/55">
                  请使用微信扫描二维码完成绑定
                </p>
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:flex">
              <button
                type="button"
                disabled={busy || !selectedConversationId}
                onClick={() => void start()}
                className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-black disabled:opacity-40 sm:px-4"
              >
                <Link size={17} />
                {binding ? "切换角色" : "绑定微信"}
              </button>
              {binding && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void unbind()}
                  className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-red-300/20 px-3 py-2.5 text-sm text-red-200 transition hover:bg-red-300/[0.06] disabled:opacity-40 sm:px-4"
                >
                  <Trash size={17} />
                  解绑
                </button>
              )}
            </div>
        </div>
      </div>
    </section>
  );
}
