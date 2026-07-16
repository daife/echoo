import type { CharacterAssetsApi } from "@echoo/api-client";

export class CharacterAssetService {
  constructor(private readonly api: CharacterAssetsApi) {}

  list(limit?: number) {
    return this.api.list(limit);
  }
  get(assetId: string) {
    return this.api.get(assetId);
  }
  publish(agentId: string, includeRecommendedRuntimeConfig: boolean) {
    return this.api.publish(agentId, { includeRecommendedRuntimeConfig });
  }
  unlist(assetId: string) {
    return this.api.unlist(assetId);
  }
  install(assetId: string, applyRecommendedRuntimeConfig: boolean) {
    return this.api.install(assetId, { applyRecommendedRuntimeConfig });
  }
  updateInstallation(assetId: string) {
    return this.api.updateInstallation(assetId);
  }
  setLiked(objectId: string, liked: boolean) {
    return liked ? this.api.like(objectId) : this.api.unlike(objectId);
  }
  listComments(objectId: string, before?: string) {
    return this.api.listComments(objectId, before);
  }
  createComment(objectId: string, body: string, parentCommentId?: string) {
    return this.api.createComment(objectId, body, parentCommentId);
  }
  updateComment(commentId: string, body: string) {
    return this.api.updateComment(commentId, body);
  }
  deleteComment(commentId: string) {
    return this.api.deleteComment(commentId);
  }
  hideComment(commentId: string) {
    return this.api.hideComment(commentId);
  }
}
