import { createHash, timingSafeEqual } from "node:crypto";

export type ZpaySignableParams = Record<string, string | undefined>;

export function canonicalizeZpayParams(params: ZpaySignableParams) {
  return Object.entries(params)
    .filter(
      ([key, value]) =>
        key !== "sign" && key !== "sign_type" && value !== undefined && value !== "",
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function signZpayParams(params: ZpaySignableParams, key: string) {
  return createHash("md5")
    .update(`${canonicalizeZpayParams(params)}${key}`, "utf8")
    .digest("hex");
}

export function verifyZpaySignature(
  params: ZpaySignableParams,
  key: string,
) {
  const received = params.sign?.toLowerCase() ?? "";
  if (!/^[a-f0-9]{32}$/.test(received)) return false;
  const expected = signZpayParams(params, key);
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}
