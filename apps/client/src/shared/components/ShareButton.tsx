import { Check, ShareNetwork, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { publicLinkUrl, type PublicLinkTarget } from "../../app/publicLinks";
import { shareOrCopy } from "../utils/share";

export function ShareButton({
  target,
  title,
  text,
  className =
    "grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/45 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.98]",
}: {
  target: PublicLinkTarget;
  title: string;
  text?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  return (
    <button
      type="button"
      className={className}
      aria-label={`分享${target.type === "post" ? "动态" : "卡片"}`}
      onClick={async () => {
        try {
          const result = await shareOrCopy({
            title,
            text,
            url: publicLinkUrl(target),
          });
          setStatus(result === "copied" ? "copied" : "idle");
        } catch {
          setStatus("error");
        }
      }}
    >
      {status === "copied" ? (
        <Check size={18} weight="bold" />
      ) : status === "error" ? (
        <WarningCircle size={18} />
      ) : (
        <ShareNetwork size={18} />
      )}
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? "已复制" : status === "error" ? "分享失败" : ""}
      </span>
    </button>
  );
}
