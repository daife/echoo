import type { PublicAssetsApi } from "@echoo/api-client";

export class PublicAssetService {
  constructor(private readonly api: PublicAssetsApi) {}

  list(input?: Parameters<PublicAssetsApi["list"]>[0]) {
    return this.api.list(input);
  }
  listFeatured(input?: Parameters<PublicAssetsApi["listFeatured"]>[0]) {
    return this.api.listFeatured(input);
  }
  listByUser(
    userId: string,
    input?: Parameters<PublicAssetsApi["listByUser"]>[1],
  ) {
    return this.api.listByUser(userId, input);
  }
  listFollowing(input?: Parameters<PublicAssetsApi["listFollowing"]>[0]) {
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
  updateInstallation(
    assetId: string,
    applyRecommendedRuntimeConfig: boolean,
    worldProgressStrategy?: "preserve-compatible" | "reset",
  ) {
    return this.api.updateInstallation(assetId, {
      applyRecommendedRuntimeConfig,
      worldProgressStrategy,
    });
  }
  createDraft(input: Parameters<PublicAssetsApi["createDraft"]>[0]) {
    return this.api.createDraft(input);
  }
  listMine() {
    return this.api.listMine();
  }
  getDraft(assetId: string) {
    return this.api.getDraft(assetId);
  }
  saveDraftContent(
    assetId: string,
    input: Parameters<PublicAssetsApi["saveDraftContent"]>[1],
  ) {
    return this.api.saveDraftContent(assetId, input);
  }
  saveDraftRecommendation(
    assetId: string,
    input: Parameters<PublicAssetsApi["saveDraftRecommendation"]>[1],
  ) {
    return this.api.saveDraftRecommendation(assetId, input);
  }
  publishDraft(assetId: string) {
    return this.api.publishDraft(assetId);
  }
}
