import type { SocialComment, SocialCommentPage } from "@echoo/shared";
import type { ApiClient } from "./client";

export class SocialApi {
  constructor(private readonly client: ApiClient) {}

  setLiked(objectId: string, liked: boolean) {
    return liked
      ? this.client.put<{ likeCount: number; viewerHasLiked: boolean }>(
          `/social/objects/${objectId}/like`,
        )
      : this.client.delete<{ likeCount: number; viewerHasLiked: boolean }>(
          `/social/objects/${objectId}/like`,
        );
  }

  listComments(objectId: string, before?: string, limit = 30) {
    return this.client
      .get<SocialCommentPage>(`/social/objects/${objectId}/comments`, {
        before,
        limit,
      })
      .then((page) => ({
        ...page,
        items: page.items.map((comment) => this.normalizeComment(comment)),
      }));
  }

  createComment(objectId: string, body: string, parentCommentId?: string) {
    return this.client
      .post<SocialComment>(`/social/objects/${objectId}/comments`, {
        body,
        ...(parentCommentId ? { parentCommentId } : {}),
      })
      .then((comment) => this.normalizeComment(comment));
  }

  updateComment(commentId: string, body: string) {
    return this.client
      .patch<SocialComment>(`/social/comments/${commentId}`, { body })
      .then((comment) => this.normalizeComment(comment));
  }

  deleteComment(commentId: string) {
    return this.client.delete<{ ok: true }>(`/social/comments/${commentId}`);
  }

  hideComment(commentId: string) {
    return this.client.post<{ ok: true }>(`/social/comments/${commentId}/hide`);
  }

  private normalizeComment(comment: SocialComment): SocialComment {
    return {
      ...comment,
      author: {
        ...comment.author,
        ...(comment.author.avatarUrl
          ? {
              avatarUrl: this.client.resolveServerPath(
                comment.author.avatarUrl,
              ),
            }
          : {}),
      },
    };
  }
}
