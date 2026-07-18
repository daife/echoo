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

  async create(authorUserId: string, body: string, resourceIds: string[]) {
    await this.validateContent(authorUserId, body, resourceIds);
    const id = await this.posts.create(authorUserId, body.trim(), resourceIds);
    return this.get(authorUserId, id);
  }

  async update(
    authorUserId: string,
    postId: string,
    body: string,
    resourceIds: string[],
  ) {
    await this.validateContent(authorUserId, body, resourceIds);
    if (
      !(await this.posts.update(authorUserId, postId, body.trim(), resourceIds))
    )
      throw new SocialPostNotFoundError("未找到可编辑的动态。");
    return this.get(authorUserId, postId);
  }

  async delete(authorUserId: string, postId: string) {
    if (!(await this.posts.delete(authorUserId, postId)))
      throw new SocialPostNotFoundError("未找到可删除的动态。");
  }

  private async validateContent(
    authorUserId: string,
    body: string,
    resourceIds: string[],
  ) {
    if (!body.trim() && !resourceIds.length)
      throw new SocialPostForbiddenError("动态需要包含文字或图片。");
    if (body.length > 4000)
      throw new SocialPostForbiddenError("动态正文不能超过 4000 字。");
    if (resourceIds.length > 3)
      throw new SocialPostForbiddenError("每条动态最多添加 3 张图片。");
    if (new Set(resourceIds).size !== resourceIds.length)
      throw new SocialPostForbiddenError("动态不能重复添加同一张图片。");
    for (const resourceId of resourceIds) {
      const resource = await this.resources.findById(resourceId);
      if (
        !resource ||
        resource.ownerUserId !== authorUserId ||
        resource.status !== "ready" ||
        resource.kind !== "end_user_image" ||
        resource.mimeType !== "image/jpeg"
      )
        throw new SocialPostForbiddenError("动态包含不可用的图片资源。");
    }
  }
}
