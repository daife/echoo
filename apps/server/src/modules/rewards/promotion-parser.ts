import type { PromotionPlatform } from "@echoo/shared";

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface ParsedPromotionContent {
  platform: PromotionPlatform;
  workType: string;
  contentId: string;
  authorId?: string;
  tags: string[];
  likeCount: number;
  sourceUrl: string;
}

export class PromotionParseError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export async function parsePromotionShare(
  shareText: string,
  fetcher: typeof fetch = fetch,
): Promise<ParsedPromotionContent> {
  const sourceUrl = extractUrl(shareText);
  const platform = platformForUrl(sourceUrl);
  try {
    if (platform === "douyin")
      return { ...(await parseDouyin(sourceUrl, fetcher)), sourceUrl };
    if (platform === "bilibili")
      return { ...(await parseBilibili(sourceUrl, fetcher)), sourceUrl };
    return { ...(await parseXiaohongshu(sourceUrl, fetcher)), sourceUrl };
  } catch (error) {
    if (error instanceof PromotionParseError) throw error;
    throw new PromotionParseError(
      error instanceof Error ? error.message : "推广内容解析失败，请稍后重试。",
      true,
    );
  }
}

export function hasEchooTag(tags: string[]) {
  return tags.some((tag) => normalizeTag(tag) === "echoo");
}

async function parseDouyin(url: string, fetcher: typeof fetch) {
  const resolved = await resolveUrl(url, fetcher, "douyin");
  const found = resolved.match(/\/(?:share\/)?(video|note)\/(\d+)/);
  if (!found)
    throw new PromotionParseError(
      "不支持的内容类型：抖音仅支持视频和图文作品。",
      false,
    );
  const [, workType, workId] = found;
  const html = await requestText(
    `https://www.iesdouyin.com/share/${workType}/${workId}/`,
    fetcher,
    { platform: "douyin" },
  );
  const match = html.match(
    /window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})<\/script>/,
  );
  if (!match)
    throw new PromotionParseError("抖音页面暂时无法读取，请稍后重试。", true);
  const router = JSON.parse(decodeHtml(match[1])) as Record<string, unknown>;
  const loader = objectValue(router.loaderData);
  const page = objectValue(loader[`${workType}_(id)/page`]);
  const response = objectValue(page.videoInfoRes);
  const items = arrayValue(response.item_list);
  const item = objectValue(items[0]);
  if (!Object.keys(item).length)
    throw new PromotionParseError("抖音作品详情为空，请稍后重试。", true);
  const author = objectValue(item.author);
  const stats = objectValue(item.statistics);
  return {
    platform: "douyin" as const,
    workType,
    contentId: stringValue(item.aweme_id) ?? workId,
    authorId:
      stringValue(author.unique_id) ??
      stringValue(author.short_id) ??
      stringValue(author.sec_uid),
    tags: extractDouyinTags(item),
    likeCount: requireCount(stats.digg_count),
  };
}

async function parseBilibili(url: string, fetcher: typeof fetch) {
  const resolved = await resolveUrl(url, fetcher, "bilibili");
  const video = resolved.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  if (video) return parseBilibiliVideo(video[1], fetcher);
  const opus = resolved.match(/\/opus\/(\d+)/);
  if (opus) return parseBilibiliOpus(opus[1], fetcher);
  if (/\/read\/(?:mobile\/)?(?:cv)?\d+/.test(resolved))
    throw new PromotionParseError(
      "不支持的内容类型：哔哩哔哩仅支持视频和动态，不支持专栏。",
      false,
    );
  throw new PromotionParseError(
    "不支持的内容类型：哔哩哔哩仅支持视频和动态。",
    false,
  );
}

async function parseBilibiliVideo(bvid: string, fetcher: typeof fetch) {
  const view = await requestJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    fetcher,
    { platform: "bilibili" },
  );
  if (numberValue(view.code) !== 0)
    throw new PromotionParseError("哔哩哔哩视频详情获取失败。", true);
  const data = objectValue(view.data);
  const tagsResponse = await requestJson(
    `https://api.bilibili.com/x/tag/archive/tags?bvid=${encodeURIComponent(bvid)}`,
    fetcher,
    {
      platform: "bilibili",
      referer: `https://www.bilibili.com/video/${bvid}/`,
    },
  );
  const tags =
    numberValue(tagsResponse.code) === 0
      ? arrayValue(tagsResponse.data)
          .map((tag) => stringValue(objectValue(tag).tag_name))
          .filter((tag): tag is string => Boolean(tag))
      : [];
  const stats = objectValue(data.stat);
  const owner = objectValue(data.owner);
  return {
    platform: "bilibili" as const,
    workType: "video",
    contentId: stringValue(data.bvid) ?? bvid,
    authorId: optionalId(owner.mid),
    tags: unique(tags),
    likeCount: requireCount(stats.like),
  };
}

async function parseBilibiliOpus(opusId: string, fetcher: typeof fetch) {
  const url = `https://www.bilibili.com/opus/${opusId}`;
  const html = await requestText(url, fetcher, {
    platform: "bilibili",
    referer: url,
  });
  const match = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\(function/,
  );
  if (!match) throw new PromotionParseError("哔哩哔哩动态详情获取失败。", true);
  const state = parseEmbeddedJson(match[1]);
  const detail = objectValue(state.detail ?? objectValue(state.opus).detail);
  const modules = arrayValue(detail.modules).map(objectValue);
  const moduleOf = (type: string) =>
    modules.find((module) => module.module_type === type) ?? {};
  const title = objectValue(moduleOf("MODULE_TYPE_TITLE").module_title);
  const author = objectValue(moduleOf("MODULE_TYPE_AUTHOR").module_author);
  const topic = objectValue(moduleOf("MODULE_TYPE_TOPIC").module_topic);
  const stats = objectValue(moduleOf("MODULE_TYPE_STAT").module_stat);
  const basic = objectValue(detail.basic);
  const titleTags = arrayValue(title.tags)
    .map((tag) =>
      typeof tag === "string"
        ? tag
        : (stringValue(objectValue(tag).text) ??
          stringValue(objectValue(tag).name)),
    )
    .filter((tag): tag is string => Boolean(tag));
  return {
    platform: "bilibili" as const,
    workType: "opus",
    contentId: stringValue(detail.id_str) ?? opusId,
    authorId: optionalId(author.mid ?? basic.uid),
    tags: unique(
      [...titleTags, stringValue(topic.name)].filter(Boolean) as string[],
    ),
    likeCount: requireCount(objectValue(stats.like).count),
  };
}

async function parseXiaohongshu(url: string, fetcher: typeof fetch) {
  const resolved = await resolveUrl(url, fetcher, "xiaohongshu");
  const noteId =
    resolved.match(/\/(?:discovery\/item|explore)\/([0-9a-fA-F]+)/)?.[1] ??
    url.match(/\/(?:discovery\/item|explore)\/([0-9a-fA-F]+)/)?.[1];
  if (!noteId)
    throw new PromotionParseError(
      "不支持的内容类型：小红书仅支持图文和视频笔记。",
      false,
    );
  const resolvedUrl = new URL(resolved);
  const token = resolvedUrl.searchParams.get("xsec_token");
  const fetchUrl = `https://www.xiaohongshu.com/explore/${noteId}${token ? `?xsec_token=${encodeURIComponent(token)}` : ""}`;
  const html = await requestText(fetchUrl, fetcher, {
    platform: "xiaohongshu",
    desktop: true,
  });
  const match = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})<\/script>/,
  );
  if (!match) throw new PromotionParseError("小红书作品详情获取失败。", true);
  const state = parseEmbeddedJson(match[1]);
  const noteStore = objectValue(state.note);
  const noteMap = objectValue(noteStore.noteDetailMap);
  const detail = objectValue(noteMap[noteId]);
  const note = objectValue(detail.note);
  if (!Object.keys(note).length)
    throw new PromotionParseError(
      "小红书作品详情为空或需要重新分享链接。",
      true,
    );
  const user = objectValue(note.user);
  const interact = objectValue(note.interactInfo);
  return {
    platform: "xiaohongshu" as const,
    workType: note.type === "video" ? "video" : "note",
    contentId: stringValue(note.noteId) ?? noteId,
    authorId: stringValue(user.userId),
    tags: unique(
      arrayValue(note.tagList)
        .map((tag) => stringValue(objectValue(tag).name))
        .filter((tag): tag is string => Boolean(tag)),
    ),
    likeCount: requireCount(interact.likedCount),
  };
}

function extractDouyinTags(item: Record<string, unknown>) {
  const tags = arrayValue(item.text_extra)
    .map(objectValue)
    .filter((extra) => numberValue(extra.type) === 1)
    .map((extra) => stringValue(extra.hashtag_name))
    .filter((tag): tag is string => Boolean(tag));
  if (tags.length) return unique(tags);
  return unique(
    Array.from(
      (stringValue(item.desc) ?? "").matchAll(/#\s*([^\s#，。,.!！?？、]+)/g),
      (match) => match[1],
    ),
  );
}

async function resolveUrl(
  initial: string,
  fetcher: typeof fetch,
  platform: PromotionPlatform,
) {
  let current = initial;
  for (let hop = 0; hop < 8; hop += 1) {
    validateUrlForPlatform(current, platform);
    const response = await request(current, fetcher, {
      platform,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new PromotionParseError("分享链接跳转缺少目标地址。", true);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok)
      throw new PromotionParseError(
        `分享链接访问失败（${response.status}）。`,
        true,
      );
    validateUrlForPlatform(response.url || current, platform);
    return response.url || current;
  }
  throw new PromotionParseError("分享链接跳转次数过多。", true);
}

async function requestText(
  url: string,
  fetcher: typeof fetch,
  options: RequestContext,
) {
  const response = await requestFollowingRedirects(url, fetcher, options);
  if (!response.ok)
    throw new PromotionParseError(
      `第三方页面访问失败（${response.status}）。`,
      true,
    );
  enforceContentLength(response);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
    throw new PromotionParseError("第三方页面响应过大。", true);
  return text;
}

async function requestFollowingRedirects(
  initial: string,
  fetcher: typeof fetch,
  options: RequestContext,
) {
  let current = initial;
  for (let hop = 0; hop < 8; hop += 1) {
    const response = await request(current, fetcher, {
      ...options,
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location)
      throw new PromotionParseError("第三方平台跳转缺少目标地址。", true);
    current = new URL(location, current).toString();
    validateUrlForPlatform(current, options.platform);
  }
  throw new PromotionParseError("第三方平台跳转次数过多。", true);
}

async function requestJson(
  url: string,
  fetcher: typeof fetch,
  options: RequestContext,
) {
  const text = await requestText(url, fetcher, options);
  return JSON.parse(text) as Record<string, unknown>;
}

interface RequestContext {
  platform: PromotionPlatform;
  referer?: string;
  desktop?: boolean;
  redirect?: RequestRedirect;
}

async function request(
  url: string,
  fetcher: typeof fetch,
  options: RequestContext,
) {
  validateUrlForPlatform(url, options.platform);
  try {
    return await fetcher(url, {
      redirect: options.redirect ?? "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": options.desktop ? DESKTOP_USER_AGENT : MOBILE_USER_AGENT,
        Accept: "text/html,application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...(options.referer ? { Referer: options.referer } : {}),
      },
    });
  } catch (error) {
    throw new PromotionParseError(
      error instanceof Error && error.name === "TimeoutError"
        ? "第三方平台响应超时，请稍后重试。"
        : "第三方平台暂时无法访问，请稍后重试。",
      true,
    );
  }
}

function platformForUrl(value: string): PromotionPlatform {
  const host = new URL(value).hostname.toLowerCase();
  if (hostMatches(host, ["douyin.com", "iesdouyin.com"])) return "douyin";
  if (hostMatches(host, ["bilibili.com", "b23.tv"])) return "bilibili";
  if (hostMatches(host, ["xiaohongshu.com", "xhslink.com"]))
    return "xiaohongshu";
  throw new PromotionParseError(
    "仅支持抖音、哔哩哔哩和小红书分享链接。",
    false,
  );
}

function validateUrlForPlatform(value: string, platform: PromotionPlatform) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new PromotionParseError("分享链接格式不安全。", false);
  const actual = platformForUrl(url.toString());
  if (actual !== platform)
    throw new PromotionParseError("分享链接跳转到了不受支持的域名。", false);
}

function extractUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s，。,:：]+/i);
  if (!match) throw new PromotionParseError("分享内容中没有找到链接。", false);
  const value = match[0].replace(/[.,，。:：]+$/, "");
  if (value.length > 2_048)
    throw new PromotionParseError("分享链接过长。", false);
  return value;
}

function hostMatches(host: string, bases: string[]) {
  return bases.some((base) => host === base || host.endsWith(`.${base}`));
}

function normalizeTag(tag: string) {
  return tag.replace(/^#+/, "").trim().toLocaleLowerCase();
}

function enforceContentLength(response: Response) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
    throw new PromotionParseError("第三方页面响应过大。", true);
}

function parseEmbeddedJson(source: string) {
  const normalized = decodeHtml(source).replace(
    /([:\[,]\s*)undefined(?=\s*[,\]}])/g,
    "$1null",
  );
  return JSON.parse(normalized) as Record<string, unknown>;
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalId(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function requireCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return requireSafeCount(Math.floor(value));
  if (typeof value === "string") {
    const normalized = value.trim().replaceAll(",", "");
    const multiplier = normalized.endsWith("万") ? 10_000 : 1;
    const numeric = Number(normalized.replace(/万$/, ""));
    if (Number.isFinite(numeric) && numeric >= 0)
      return requireSafeCount(Math.floor(numeric * multiplier));
  }
  throw new PromotionParseError("第三方平台未返回有效点赞数。", true);
}

function requireSafeCount(value: number) {
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
