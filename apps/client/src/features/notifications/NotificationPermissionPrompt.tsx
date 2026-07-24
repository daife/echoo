import { BellSimple, X } from "@phosphor-icons/react";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";

export function NotificationPermissionPrompt({
  onEnable,
  onDismiss,
}: {
  onEnable: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  useBackHandler(onDismiss, { priority: BACK_HANDLER_PRIORITY.prompt });

  return (
    <aside className="fixed bottom-24 right-5 z-[70] w-[min(360px,calc(100%-40px))] overflow-hidden rounded-2xl border border-white/12 bg-[#121217]/95 p-4 shadow-[0_22px_70px_rgba(0,0,0,0.48)] backdrop-blur-2xl md:bottom-6">
      <button
        type="button"
        aria-label="暂不开启通知"
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-white/35 transition hover:bg-white/[0.06] hover:text-white"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>
      <div className="flex gap-3 pr-8">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-red-300/20 bg-red-300/[0.08] text-red-100">
          <BellSimple size={19} weight="fill" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-white">及时收到新消息</h2>
          <p className="mt-1 text-xs leading-5 text-white/45">
            开启系统通知，应用在后台时也能提醒你。
          </p>
        </div>
      </div>
      <button
        type="button"
        className="mt-4 w-full rounded-full bg-white py-2.5 text-sm font-medium text-[#09090b] transition active:scale-[0.98]"
        onClick={() => void onEnable()}
      >
        开启通知
      </button>
    </aside>
  );
}
