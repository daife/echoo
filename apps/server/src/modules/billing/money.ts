export function formatMicroUsd(value: number) {
  return (value / 1_000_000).toFixed(6).replace(/\.?0+$/, "") || "0";
}

export function parseUsdToMicro(value: string) {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value.trim()))
    throw new Error("金额必须是最多 6 位小数的美元数值。");
  const negative = value.trim().startsWith("-");
  const unsigned = value.trim().replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const micro = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(micro)) throw new Error("金额超出支持范围。");
  return negative ? -micro : micro;
}

export function normalizeNonNegativeUsd(value: string) {
  const micro = parseUsdToMicro(value);
  if (micro < 0) throw new Error("奖励金额不能为负数。");
  return formatMicroUsd(micro);
}
