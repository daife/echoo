import type { CharacterAssetsApi } from "@echoo/api-client";

export class CharacterAssetService {
  constructor(private readonly api: CharacterAssetsApi) {}

  list(input?: Parameters<CharacterAssetsApi["list"]>[0]) {
    return this.api.list(input);
  }
  listFeatured(input?: Parameters<CharacterAssetsApi["listFeatured"]>[0]) {
    return this.api.listFeatured(input);
  }
  listByUser(userId: string, input?: { limit?: number; cursor?: string }) {
    return this.api.listByUser(userId, input);
  }
  listFollowing(input?: { limit?: number; cursor?: string }) {
    return this.api.listFollowing(input);
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
}
