import type {
  PostsApi,
  ResourcesApi,
  SocialApi,
  UsersApi,
} from "@echoo/api-client";
import type { SocialPostContentInput } from "@echoo/shared";

export class SocialService {
  constructor(
    private readonly posts: PostsApi,
    private readonly users: UsersApi,
    private readonly social: SocialApi,
    private readonly resources: ResourcesApi,
  ) {}

  createPost(content: SocialPostContentInput[]) {
    return this.posts.create({ content });
  }
  getPost(postId: string) {
    return this.posts.get(postId);
  }
  updatePost(postId: string, content: SocialPostContentInput[]) {
    return this.posts.update(postId, { content });
  }
  deletePost(postId: string) {
    return this.posts.delete(postId);
  }
  listFollowingPosts(input?: { limit?: number; cursor?: string }) {
    return this.posts.listFollowing(input);
  }
  listUserPosts(userId: string, input?: { limit?: number; cursor?: string }) {
    return this.posts.listByUser(userId, input);
  }
  getUser(userId: string) {
    return this.users.get(userId);
  }
  setFollowing(userId: string, following: boolean) {
    return this.users.setFollowing(userId, following);
  }
  listFollowers(userId: string, input?: { limit?: number; cursor?: string }) {
    return this.users.listFollowers(userId, input);
  }
  listFollowingUsers(
    userId: string,
    input?: { limit?: number; cursor?: string },
  ) {
    return this.users.listFollowing(userId, input);
  }
  setLiked(objectId: string, liked: boolean) {
    return this.social.setLiked(objectId, liked);
  }
  listComments(objectId: string, before?: string) {
    return this.social.listComments(objectId, before);
  }
  createComment(objectId: string, body: string, parentCommentId?: string) {
    return this.social.createComment(objectId, body, parentCommentId);
  }
  updateComment(commentId: string, body: string) {
    return this.social.updateComment(commentId, body);
  }
  deleteComment(commentId: string) {
    return this.social.deleteComment(commentId);
  }
  hideComment(commentId: string) {
    return this.social.hideComment(commentId);
  }

  async uploadPostMedia(file: File, type: "image" | "audio") {
    const ticket = await this.resources.createUpload({
      kind: type === "image" ? "end_user_image" : "end_user_voice",
      fileName: file.name,
      mimeType: type === "image" ? "image/jpeg" : "audio/mpeg",
      byteSize: file.size,
    });
    await this.resources.upload(ticket, file);
    await this.resources.complete(ticket.resourceId);
    for (const delayMs of [300, 700, 1_500, 3_000, 5_000, 8_000]) {
      await delay(delayMs);
      const status = await this.resources.status(ticket.resourceId);
      if (status.status === "ready") return ticket.resourceId;
      if (status.status === "failed")
        throw new Error(type === "image" ? "图片处理失败。" : "语音处理失败。");
    }
    throw new Error(`${type === "image" ? "图片" : "语音"}处理超时，请稍后重试。`);
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
