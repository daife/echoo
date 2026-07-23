import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicAssetQueryError,
  decodeAssetCursor,
  encodeAssetCursor,
  normalizeSearchQuery,
  rowToListItem,
  truncatePreview,
} from "./public-asset.repository.js";

test("asset cursors are opaque, scoped, and reject malformed values", () => {
  const cursor = encodeAssetCursor(
    { published_at: 123, id: "asset_1" },
    "published:林晚",
  );
  assert.deepEqual(decodeAssetCursor(cursor, "published:林晚"), {
    publishedAt: 123,
    id: "asset_1",
  });
  assert.throws(
    () => decodeAssetCursor(cursor, "published:作者"),
    PublicAssetQueryError,
  );
  assert.throws(
    () => decodeAssetCursor("not-a-cursor", "published:林晚"),
    PublicAssetQueryError,
  );
});

test("search queries and previews are normalized and bounded", () => {
  assert.equal(normalizeSearchQuery("  林晚   插画师 "), "林晚 插画师");
  assert.equal(truncatePreview("  温柔\n敏感  ", 20), "温柔 敏感");
  assert.equal(truncatePreview("123456", 5), "1234…");
});

test("list items omit the full character definition", () => {
  const item = rowToListItem({
    id: "asset_1",
    author_user_id: "user_1",
    display_name: "作者",
    latest_version_id: "version_1",
    version_number: 2,
    snapshot: {
      type: "slice-figure",
      name: "林晚",
      coverResourcePath: "/resources/cover",
      attributes: [
        { key: "关系", value: "朋友" },
        { key: "城市", value: "厦门" },
        { key: "隐藏", value: "不应进入列表" },
      ],
      tags: ["温柔", "插画师", "日常", "隐藏标签"],
      introduction: "公开预览",
      detail: {
        persona: "敏感完整人设",
        background: "完整背景",
        personality: "性格",
        responseStyle: "回复风格",
        systemPrompt: "私有系统提示词",
        memorySummaryPrompt: "私有记忆提示词",
        prologueHtml: "",
        currentSituation: "",
        openingLine: "",
        linkedAgentIds: [],
      },
    },
    recommended_runtime_config: { secret: true },
    like_count: 4,
    comment_count: 2,
    viewer_has_liked: 1,
    installed_version_id: null,
    installed_version_number: null,
    installation_id: null,
    published_at: 100,
    updated_at: 100,
  } as never);

  assert.equal(item.snapshot.preview, "公开预览");
  assert.equal(item.snapshot.attributes.length, 2);
  assert.equal(item.snapshot.tags.length, 3);
  assert.equal("detail" in item.snapshot, false);
  assert.equal("recommendedRuntimeConfig" in item, false);
});
