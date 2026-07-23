import { SealCheck } from "@phosphor-icons/react";
import { MediaAsset } from "../../features/media/MediaAsset";
import { cn } from "../utils/cn";

export function IdentityAvatar({
  mediaUrl,
  alt,
  className,
  variant = "thumb",
  isAdmin = false,
}: {
  mediaUrl?: string;
  alt: string;
  className?: string;
  variant?: "thumb" | "display";
  isAdmin?: boolean;
}) {
  return (
    <div
      className={cn("relative shrink-0", className)}
      data-identity-avatar={mediaUrl ? "image" : "empty"}
      data-admin-avatar={isAdmin ? "true" : undefined}
    >
      <div className="h-full w-full overflow-hidden rounded-full border border-white/12 bg-white/[0.035]">
        {mediaUrl ? (
          <MediaAsset
            mediaUrl={mediaUrl}
            variant={variant}
            containerClassName="h-full w-full bg-transparent"
            className="h-full w-full object-cover"
            alt={alt}
            fallbackLabel=""
          />
        ) : null}
      </div>
      {isAdmin ? (
        <span
          aria-label="管理员账号"
          title="管理员账号"
          className="absolute -bottom-[4%] -right-[4%] grid h-[38%] w-[38%] min-h-4 min-w-4 place-items-center rounded-full border border-[#111114] bg-[#d8c7ff] text-[#16111f] shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
        >
          <SealCheck size="72%" weight="fill" />
        </span>
      ) : null}
    </div>
  );
}
