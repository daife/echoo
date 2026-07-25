import { ShareNetwork } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { publicLinkUrl, type PublicLinkTarget } from "../../app/publicLinks";
import { shareOrCopy } from "../utils/share";

export function ShareButton({
  target,
  title,
  text,
  className = "flex items-center gap-2 text-sm text-white/45 hover:text-white",
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
      <ShareNetwork size={18} />
      {status === "copied"
        ? "已复制"
        : status === "error"
          ? "分享失败"
          : "分享"}
    </button>
  );
}
