import type { SocialPostContentInput } from "@echoo/shared";
import { ResourceRepository } from "../resources/resource.repository.js";
import { SocialPostRepository } from "./social-post.repository.js";

export class SocialPostNotFoundError extends Error {}
export class SocialPostForbiddenError extends Error {}

export class SocialPostService {
  constructor(
    private readonly posts = new SocialPostRepository(),
    private readonly resources = new ResourceRepository(),
  ) {}

  listByAuthor(
    viewerUserId: string | null,
    authorUserId: string,
    input?: { limit?: number; cursor?: string },
  ) {
    return this.posts.listByAuthor(viewerUserId, authorUserId, input);
  }

  listFollowing(
    viewerUserId: string,
    input?: { limit?: number; cursor?: string },
  ) {
    return this.posts.listFollowing(viewerUserId, input);
  }

  async get(viewerUserId: string | null, postId: string) {
    const post = await this.posts.find(viewerUserId, postId);
    if (!post) throw new SocialPostNotFoundError("动态不存在。");
    return post;
  }

  async create(authorUserId: string, content: SocialPostContentInput[]) {
    const normalized = await this.validateContent(authorUserId, content);
    const id = await this.posts.create(authorUserId, normalized);
    return this.get(authorUserId, id);
  }

  async update(
    authorUserId: string,
    postId: string,
    content: SocialPostContentInput[],
  ) {
    const normalized = await this.validateContent(authorUserId, content);
    if (!(await this.posts.update(authorUserId, postId, normalized)))
      throw new SocialPostNotFoundError("未找到可编辑的动态。");
    return this.get(authorUserId, postId);
  }

  async delete(authorUserId: string, postId: string) {
    if (!(await this.posts.delete(authorUserId, postId)))
      throw new SocialPostNotFoundError("未找到可删除的动态。");
  }

  private async validateContent(
    authorUserId: string,
    content: SocialPostContentInput[],
  ) {
    const normalized = normalizePostContent(content);
    const textLength = normalized.reduce(
      (total, block) => total + (block.type === "text" ? block.text.length : 0),
      0,
    );
    const images = normalized.filter((block) => block.type === "image");
    const audio = normalized.filter((block) => block.type === "audio");
    const media = normalized.filter(
      (block): block is Exclude<SocialPostContentInput, { type: "text" }> =>
        block.type !== "text",
    );
    if (!normalized.length)
      throw new SocialPostForbiddenError("动态需要包含文字、图片或语音。");
    if (textLength > 4000)
      throw new SocialPostForbiddenError("动态正文不能超过 4000 字。");
    if (images.length > 3)
      throw new SocialPostForbiddenError("每条动态最多添加 3 张图片。");
    if (audio.length > 10)
      throw new SocialPostForbiddenError("每条动态最多添加 10 条语音。");
    if (new Set(media.map((block) => block.resourceId)).size !== media.length)
      throw new SocialPostForbiddenError("动态不能重复添加同一媒体资源。");
    for (const block of media) {
      const resource = await this.resources.findById(block.resourceId);
      const matchesType =
        block.type === "image"
          ? resource?.kind === "end_user_image" &&
            resource.mimeType === "image/jpeg"
          : resource?.kind === "end_user_voice" &&
            resource.mimeType === "audio/mpeg";
      if (
        !resource ||
        resource.ownerUserId !== authorUserId ||
        resource.status !== "ready" ||
        !matchesType
      )
        throw new SocialPostForbiddenError("动态包含不可用或类型不匹配的媒体资源。");
    }
    return normalized;
  }
}

export function normalizePostContent(content: SocialPostContentInput[]) {
  const normalized: SocialPostContentInput[] = [];
  for (const block of content) {
    if (block.type !== "text") {
      normalized.push({ ...block, resourceId: block.resourceId.trim() });
      continue;
    }
    if (!block.text.trim()) continue;
    const previous = normalized.at(-1);
    if (previous?.type === "text") previous.text += block.text;
    else normalized.push({ type: "text", text: block.text });
  }
  return normalized;
}
