import type { CharacterAssetsApi } from "@echoo/api-client";

export class CharacterAssetService {
  constructor(private readonly api: CharacterAssetsApi) {}

  list(input?: Parameters<CharacterAssetsApi["list"]>[0]) {
    return this.api.list(input);
  }
  get(assetId: string) {
    return this.api.get(assetId);
  }
  unlist(assetId: string) {
    return this.api.unlist(assetId);
  }
  delete(assetId: string) {
    return this.api.delete(assetId);
  }
  install(assetId: string, applyRecommendedRuntimeConfig: boolean) {
    return this.api.install(assetId, { applyRecommendedRuntimeConfig });
  }
  updateInstallation(assetId: string, applyRecommendedRuntimeConfig: boolean) {
    return this.api.updateInstallation(assetId, {
      applyRecommendedRuntimeConfig,
    });
  }
  createDraft(input: Parameters<CharacterAssetsApi["createDraft"]>[0]) {
    return this.api.createDraft(input);
  }
  listMine() {
    return this.api.listMine();
  }
  getDraft(assetId: string) {
    return this.api.getDraft(assetId);
  }
  saveDraftCharacter(
    assetId: string,
    input: Parameters<CharacterAssetsApi["saveDraftCharacter"]>[1],
  ) {
    return this.api.saveDraftCharacter(assetId, input);
  }
  saveDraftRecommendation(
    assetId: string,
    input: Parameters<CharacterAssetsApi["saveDraftRecommendation"]>[1],
  ) {
    return this.api.saveDraftRecommendation(assetId, input);
  }
  publishDraft(assetId: string) {
    return this.api.publishDraft(assetId);
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
