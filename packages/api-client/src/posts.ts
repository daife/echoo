import type {
  CreateSocialPostRequest,
  SocialPostDetail,
  SocialPostPage,
  UpdateSocialPostRequest,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class PostsApi {
  constructor(private readonly client: ApiClient) {}

  create(input: CreateSocialPostRequest) {
    return this.client
      .post<SocialPostDetail>("/posts", input)
      .then((post) => this.normalize(post));
  }
  get(postId: string) {
    return this.client
      .get<SocialPostDetail>(`/posts/${postId}`)
      .then((post) => this.normalize(post));
  }
  update(postId: string, input: UpdateSocialPostRequest) {
    return this.client
      .patch<SocialPostDetail>(`/posts/${postId}`, input)
      .then((post) => this.normalize(post));
  }
  delete(postId: string) {
    return this.client.delete<{ ok: true }>(`/posts/${postId}`);
  }
  listByUser(userId: string, input: { limit?: number; cursor?: string } = {}) {
    return this.client
      .get<SocialPostPage>(`/users/${userId}/posts`, input)
      .then((page) => this.normalizePage(page));
  }
  listFollowing(input: { limit?: number; cursor?: string } = {}) {
    return this.client
      .get<SocialPostPage>("/feeds/following/posts", input)
      .then((page) => this.normalizePage(page));
  }

  private normalizePage(page: SocialPostPage): SocialPostPage {
    return { ...page, items: page.items.map((post) => this.normalize(post)) };
  }
  private normalize<T extends SocialPostDetail>(post: T): T {
    return {
      ...post,
      author: {
        ...post.author,
        ...(post.author.avatarUrl
          ? { avatarUrl: this.client.resolveServerPath(post.author.avatarUrl) }
          : {}),
      },
      content: post.content.map((block) =>
        block.type === "text"
          ? block
          : {
              ...block,
              resourcePath:
                this.client.resolveServerPath(block.resourcePath) ??
                block.resourcePath,
            },
      ),
    };
  }
}
