import { MediaAsset } from "../../features/media/MediaAsset";
import { cn } from "../utils/cn";

export function IdentityAvatar({
  mediaUrl,
  alt,
  className,
  variant = "thumb",
}: {
  mediaUrl?: string;
  alt: string;
  className?: string;
  variant?: "thumb" | "display";
}) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-full border border-white/12 bg-white/[0.035]",
        className,
      )}
      data-identity-avatar={mediaUrl ? "image" : "empty"}
    >
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
  );
}
