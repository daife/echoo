import { SocialRepository, rowToComment } from "./social.repository.js";

export class SocialObjectNotFoundError extends Error {}
export class SocialActionForbiddenError extends Error {}

export class SocialService {
  constructor(private readonly social = new SocialRepository()) {}

  async setLike(objectId: string, userId: string, liked: boolean) {
    const object = await this.requireObject(objectId, userId);
    if (
      liked &&
      object.object_type === "public_asset" &&
      object.asset_status !== "published"
    )
      throw new SocialActionForbiddenError("已下架资产不能新增点赞。");
    return this.social.setLike(objectId, userId, liked);
  }

  async listComments(
    objectId: string,
    viewerUserId: string | null,
    before: number | undefined,
    limit: number,
  ) {
    await this.requireObject(objectId, viewerUserId);
    return this.social.listComments({
      objectId,
      viewerUserId,
      before,
      limit: Math.min(Math.max(limit, 1), 100),
    });
  }

  async createComment(input: {
    objectId: string;
    authorUserId: string;
    body: string;
    parentCommentId?: string;
  }) {
    const object = await this.requireObject(input.objectId, input.authorUserId);
    if (
      object.object_type === "public_asset" &&
      object.asset_status !== "published"
    )
      throw new SocialActionForbiddenError("已下架资产不能新增评论。");
    const id = await this.social.createComment(input);
    if (!id)
      throw new SocialActionForbiddenError(
        "回复目标不存在或不能继续嵌套回复。",
      );
    const comment = await this.social.findComment(id);
    if (!comment) throw new Error("评论创建后读取失败。");
    return rowToComment(comment, input.authorUserId);
  }

  async updateComment(commentId: string, userId: string, body: string) {
    if (!(await this.social.updateComment(commentId, userId, body)))
      throw new SocialActionForbiddenError("无权编辑该评论。");
    const comment = await this.social.findComment(commentId);
    if (!comment) throw new SocialObjectNotFoundError("评论不存在。");
    return rowToComment(comment, userId);
  }

  async deleteComment(commentId: string, userId: string) {
    if (
      !(await this.social.moderateComment({
        commentId,
        actorUserId: userId,
        hide: false,
      }))
    )
      throw new SocialActionForbiddenError("无权删除该评论。");
  }

  async hideComment(commentId: string, userId: string) {
    if (
      !(await this.social.moderateComment({
        commentId,
        actorUserId: userId,
        hide: true,
      }))
    )
      throw new SocialActionForbiddenError("无权隐藏该评论。");
  }

  private async requireObject(objectId: string, viewerUserId: string | null) {
    const object = await this.social.findObject(objectId, viewerUserId);
    if (
      !object ||
      (object.object_type !== "public_asset" &&
        object.object_type !== "post")
    )
      throw new SocialObjectNotFoundError("社交对象不存在。");
    if (!object.viewer_can_access)
      throw new SocialObjectNotFoundError("社交对象不存在。");
    return object;
  }
}
