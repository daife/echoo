import type { RuntimeConfigWarning } from "@echoo/shared";

export function runtimeConfigNotice(
  base: string,
  warnings?: RuntimeConfigWarning[],
) {
  const relevantWarnings = warnings?.filter(
    (warning) => warning.code !== "MODEL_METADATA_STALE",
  );
  return relevantWarnings?.length
    ? `${base} 提示：${relevantWarnings.map((warning) => warning.message).join("；")}`
    : base;
}
