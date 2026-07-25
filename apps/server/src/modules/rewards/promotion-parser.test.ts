import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEchooTag,
  parsePromotionShare,
  PromotionParseError,
} from "./promotion-parser.js";

test("parses a Douyin work id, tags, author and likes", async () => {
  const fetcher = fixtureFetch((url) => {
    if (url.includes("iesdouyin.com/share/video/123"))
      return html(
        `window._ROUTER_DATA = ${JSON.stringify({
          loaderData: {
            "video_(id)/page": {
              videoInfoRes: {
                item_list: [
                  {
                    aweme_id: "123",
                    desc: "hello #echoo",
                    text_extra: [{ type: 1, hashtag_name: "Echoo" }],
                    author: { unique_id: "author-a" },
                    statistics: { digg_count: 321 },
                  },
                ],
              },
            },
          },
        })}</script>`,
      );
    return html("");
  });
  const parsed = await parsePromotionShare(
    "看看 https://www.douyin.com/video/123",
    fetcher,
  );
  assert.equal(parsed.platform, "douyin");
  assert.equal(parsed.contentId, "123");
  assert.equal(parsed.authorId, "author-a");
  assert.equal(parsed.likeCount, 321);
  assert.equal(hasEchooTag(parsed.tags), true);
});

test("caps out-of-range likes so the reward can use its configured maximum", async () => {
  const fetcher = fixtureFetch((url) => {
    if (url.includes("iesdouyin.com/share/video/456"))
      return html(
        `window._ROUTER_DATA = ${JSON.stringify({
          loaderData: {
            "video_(id)/page": {
              videoInfoRes: {
                item_list: [
                  {
                    aweme_id: "456",
                    desc: "#echoo",
                    statistics: { digg_count: Number.MAX_VALUE },
                  },
                ],
              },
            },
          },
        })}</script>`,
      );
    return html("");
  });
  const parsed = await parsePromotionShare(
    "https://www.douyin.com/video/456",
    fetcher,
  );
  assert.equal(parsed.likeCount, Number.MAX_SAFE_INTEGER);
});

test("parses Bilibili video API data and tags", async () => {
  const fetcher = fixtureFetch((url) => {
    if (url.includes("/x/web-interface/view"))
      return json({
        code: 0,
        data: {
          bvid: "BV1abc",
          owner: { mid: 42 },
          stat: { like: 800 },
        },
      });
    if (url.includes("/x/tag/archive/tags"))
      return json({ code: 0, data: [{ tag_name: "echoo" }] });
    return html("");
  });
  const parsed = await parsePromotionShare(
    "https://www.bilibili.com/video/BV1abc",
    fetcher,
  );
  assert.deepEqual(
    { id: parsed.contentId, author: parsed.authorId, likes: parsed.likeCount },
    { id: "BV1abc", author: "42", likes: 800 },
  );
  assert.equal(hasEchooTag(parsed.tags), true);
});

test("parses Bilibili opus embedded state", async () => {
  const state = {
    detail: {
      id_str: "987",
      basic: { uid: 7 },
      modules: [
        {
          module_type: "MODULE_TYPE_TITLE",
          module_title: { tags: [{ text: "echoo" }] },
        },
        {
          module_type: "MODULE_TYPE_STAT",
          module_stat: { like: { count: 66 } },
        },
      ],
    },
  };
  const fetcher = fixtureFetch((url) =>
    url.includes("/opus/987")
      ? html(`window.__INITIAL_STATE__=${JSON.stringify(state)};(function`)
      : html(""),
  );
  const parsed = await parsePromotionShare(
    "https://www.bilibili.com/opus/987",
    fetcher,
  );
  assert.equal(parsed.workType, "opus");
  assert.equal(parsed.likeCount, 66);
  assert.equal(hasEchooTag(parsed.tags), true);
});

test("parses Xiaohongshu note counts including ten-thousand notation", async () => {
  const state = {
    note: {
      noteDetailMap: {
        abc123: {
          note: {
            noteId: "abc123",
            type: "normal",
            user: { userId: "red-author" },
            tagList: [{ name: "ECHOO" }],
            interactInfo: { likedCount: "1.2万" },
          },
        },
      },
    },
  };
  const fetcher = fixtureFetch(() =>
    html(`window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`),
  );
  const parsed = await parsePromotionShare(
    "https://www.xiaohongshu.com/explore/abc123",
    fetcher,
  );
  assert.equal(parsed.likeCount, 12_000);
  assert.equal(parsed.authorId, "red-author");
  assert.equal(hasEchooTag(parsed.tags), true);
});

test("rejects unsupported domains and Bilibili articles", async () => {
  await assert.rejects(
    () =>
      parsePromotionShare(
        "https://example.com/video/1",
        fixtureFetch(() => html("")),
      ),
    PromotionParseError,
  );
  await assert.rejects(
    () =>
      parsePromotionShare(
        "https://www.bilibili.com/read/cv123",
        fixtureFetch(() => html("")),
      ),
    /不支持的内容类型：哔哩哔哩仅支持视频和动态，不支持专栏/,
  );
});

test("echoo tag matching is exact and case insensitive", () => {
  assert.equal(hasEchooTag(["# ECHOO", "other"]), true);
  assert.equal(hasEchooTag(["echoo推广", "other"]), false);
});

function fixtureFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input) => handler(String(input))) as typeof fetch;
}

function html(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
