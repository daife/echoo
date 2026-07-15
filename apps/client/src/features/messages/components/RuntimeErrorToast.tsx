import { WarningCircle, X } from "@phosphor-icons/react";
import type { RuntimeErrorNotice } from "../messagePresentation";

export const RUNTIME_ERROR_TOAST_DURATION_MS = 6_000;

export function RuntimeErrorToast({
  notice,
  onDismiss,
}: {
  notice: RuntimeErrorNotice;
  onDismiss: () => void;
}) {
  return (
    <div
      className="absolute bottom-4 left-1/2 z-20 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border border-red-300/15 bg-[#211719]/95 px-4 py-3 text-red-50 shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      role="alert"
    >
      <WarningCircle
        className="mt-0.5 flex-none text-red-300/85"
        size={18}
        weight="fill"
      />
      <p className="min-w-0 flex-1 break-words text-xs leading-5 text-red-100/85">
        运行失败：{notice.text}
      </p>
      <button
        aria-label="关闭运行失败提示"
        className="grid h-6 w-6 flex-none place-items-center rounded-md text-red-100/45 transition hover:bg-white/[0.06] hover:text-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-100"
        type="button"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
