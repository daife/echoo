export function ConversationHeaderTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="min-w-0">
      <h1 className="truncate text-base font-semibold tracking-[-0.015em] text-white">
        {title}
      </h1>
      <p className="truncate text-xs leading-4 text-white/45">{subtitle}</p>
    </div>
  );
}
