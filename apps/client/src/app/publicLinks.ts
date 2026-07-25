export type PublicLinkTarget =
  { type: "post"; id: string } | { type: "card"; id: string };

const targetKeys = ["post", "card"] as const;
const targetIdPattern = /^(?:post|asset)_[A-Za-z0-9-]{1,80}$/;

export function parsePublicLinkTarget(
  input: string | URL | URLSearchParams,
): PublicLinkTarget | null {
  const params =
    input instanceof URLSearchParams
      ? input
      : input instanceof URL
        ? input.searchParams
        : new URL(input, "https://echoo.invalid").searchParams;
  const present = targetKeys.filter((key) => params.has(key));
  if (present.length !== 1) return null;
  const key = present[0]!;
  const values = params.getAll(key);
  if (values.length !== 1) return null;
  const id = values[0]!.trim();
  if (!targetIdPattern.test(id)) return null;
  if (key === "post" && !id.startsWith("post_")) return null;
  if (key === "card" && !id.startsWith("asset_")) return null;
  return { type: key, id };
}

export function publicLinkUrl(
  target: PublicLinkTarget,
  publicWebUrl = configuredPublicWebUrl(),
) {
  const url = new URL(publicWebUrl);
  url.pathname = normalizeRootPath(url.pathname);
  url.search = "";
  url.hash = "";
  url.searchParams.set(target.type === "post" ? "post" : "card", target.id);
  return url.toString();
}

export function syncPublicLinkTarget(target: PublicLinkTarget | null) {
  const url = new URL(window.location.href);
  targetKeys.forEach((key) => url.searchParams.delete(key));
  if (target)
    url.searchParams.set(target.type === "post" ? "post" : "card", target.id);
  window.history.replaceState(window.history.state, "", url);
}

export function configuredPublicWebUrl() {
  const configured = import.meta.env.VITE_PUBLIC_WEB_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (!/^https?:$/.test(url.protocol))
      throw new Error("VITE_PUBLIC_WEB_URL 必须使用 http 或 https。");
    return url.toString();
  }
  if (/^https?:$/.test(window.location.protocol)) return window.location.origin;
  throw new Error("桌面或移动客户端必须配置 VITE_PUBLIC_WEB_URL 才能分享。");
}

export function isInternalPublicLink(url: URL) {
  const origins = new Set<string>();
  try {
    origins.add(new URL(configuredPublicWebUrl()).origin);
  } catch {
    // A packaged client may render links before its public URL is configured.
  }
  if (/^https?:$/.test(window.location.protocol))
    origins.add(window.location.origin);
  return publicLinkTargetForOrigins(url, origins);
}

export function publicLinkTargetForOrigins(
  url: URL,
  origins: Iterable<string>,
) {
  const allowedOrigins = new Set(
    [...origins].map((origin) => new URL(origin).origin),
  );
  return allowedOrigins.has(url.origin) ? parsePublicLinkTarget(url) : null;
}

function normalizeRootPath(pathname: string) {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}
