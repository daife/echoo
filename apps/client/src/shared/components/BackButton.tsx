import { ArrowLeft } from "@phosphor-icons/react";

export function BackButton({
  onClick,
  label = "返回",
  className = "",
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/48 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 active:translate-y-px ${className}`}
      type="button"
      onClick={onClick}
    >
      <ArrowLeft size={19} />
    </button>
  );
}
