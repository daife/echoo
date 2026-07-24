import type {
  PublicAssetDetail,
  PublicAssetDraft,
  PublicAssetListItem,
  PublicAssetPage,
  PublicAssetSnapshot,
  PublicAssetSummary,
  CreatePublicAssetDraftRequest,
  InstallPublicAssetResponse,
  InstallPublicAssetRequest,
  PublishPublicAssetResponse,
  SavePublicAssetRecommendationRequest,
  SavePrimeWorldBundleDraftRequest,
} from "@echoo/shared/public-assets";
import type {
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
} from "@echoo/shared";
import { normalizeAgentResources } from "./agents";
import type { ApiClient } from "./client";

export class PublicAssetsApi {
  constructor(private readonly client: ApiClient) {}

  list(
    input: {
      limit?: number;
      cursor?: string;
      q?: string;
      type?: PublicAssetSnapshot["type"];
      signal?: AbortSignal;
    } = {},
  ): Promise<PublicAssetPage> {
    const { signal, ...query } = input;
    return this.client
      .get<PublicAssetPage>("/public-assets", query, { signal })
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeListItem(asset)),
      }));
  }

  listFeatured(
    input: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<PublicAssetListItem[]> {
    const { signal, ...query } = input;
    return this.client
      .get<PublicAssetListItem[]>(
        "/public-assets/featured",
        query,
        { signal },
      )
      .then((items) => items.map((asset) => this.normalizeListItem(asset)));
  }

  listByUser(
    userId: string,
    input: {
      limit?: number;
      cursor?: string;
      type?: PublicAssetSnapshot["type"];
    } = {},
  ) {
    return this.client
      .get<PublicAssetPage>(`/users/${userId}/public-assets`, input)
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeListItem(asset)),
      }));
  }

  listFollowing(
    input: {
      limit?: number;
      cursor?: string;
      type?: PublicAssetSnapshot["type"];
    } = {},
  ) {
    return this.client
      .get<PublicAssetPage>("/feeds/following/public-assets", input)
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeListItem(asset)),
      }));
  }

  get(assetId: string): Promise<PublicAssetDetail> {
    return this.client
      .get<PublicAssetDetail>(`/public-assets/${assetId}`)
      .then((asset) => this.normalizeAsset(asset));
  }

  unlist(assetId: string) {
    return this.client.post<{ ok: true }>(
      `/public-assets/${assetId}/unlist`,
    );
  }

  delete(assetId: string) {
    return this.client.delete<{ ok: true }>(`/public-assets/${assetId}`);
  }

  install(
    assetId: string,
    input: InstallPublicAssetRequest,
  ): Promise<InstallPublicAssetResponse> {
    return this.client
      .post<InstallPublicAssetResponse>(
        `/public-assets/${assetId}/install`,
        input,
      )
      .then((response) => ({
        ...response,
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  updateInstallation(
    assetId: string,
    input: InstallPublicAssetRequest,
  ): Promise<InstallPublicAssetResponse> {
    return this.client
      .post<InstallPublicAssetResponse>(
        `/public-assets/${assetId}/install/update`,
        input,
      )
      .then((response) => ({
        ...response,
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  createDraft(
    input: CreatePublicAssetDraftRequest,
  ): Promise<PublicAssetDraft> {
    return this.client
      .post<PublicAssetDraft>("/public-assets/drafts", input)
      .then((draft) => this.normalizeDraft(draft));
  }

  listMine(): Promise<PublicAssetDraft[]> {
    return this.client
      .get<PublicAssetDraft[]>("/users/me/public-assets")
      .then((drafts) => drafts.map((draft) => this.normalizeDraft(draft)));
  }

  getDraft(assetId: string): Promise<PublicAssetDraft> {
    return this.client
      .get<PublicAssetDraft>(`/public-assets/${assetId}/draft`)
      .then((draft) => this.normalizeDraft(draft));
  }

  saveDraftContent(
    assetId: string,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest | CreatePrimeWorldRequest,
  ): Promise<PublicAssetDraft> {
    return this.client
      .patch<PublicAssetDraft>(
        `/public-assets/${assetId}/draft/content`,
        input,
      )
      .then((draft) => this.normalizeDraft(draft));
  }

  saveDraftBundle(
    assetId: string,
    input: SavePrimeWorldBundleDraftRequest,
  ): Promise<PublicAssetDraft> {
    return this.client
      .patch<PublicAssetDraft>(
        `/public-assets/${assetId}/draft/content/bundle`,
        input,
      )
      .then((draft) => this.normalizeDraft(draft));
  }

  saveDraftRecommendation(
    assetId: string,
    input: SavePublicAssetRecommendationRequest,
  ): Promise<PublicAssetDraft> {
    return this.client
      .patch<PublicAssetDraft>(
        `/public-assets/${assetId}/draft/recommendation`,
        input,
      )
      .then((draft) => this.normalizeDraft(draft));
  }

  publishDraft(assetId: string): Promise<PublishPublicAssetResponse> {
    return this.client
      .post<PublishPublicAssetResponse>(
        `/public-assets/${assetId}/publish`,
      )
      .then((response) => ({
        ...response,
        asset: this.normalizeAsset(response.asset),
      }));
  }

  private normalizeAsset<T extends PublicAssetSummary>(asset: T): T {
    const snapshot = normalizeSnapshot(this.client, asset.snapshot);
    return {
      ...asset,
      snapshot,
      ...("latestVersion" in asset
        ? {
            latestVersion: {
              ...(asset as PublicAssetDetail).latestVersion,
              snapshot,
            },
          }
        : {}),
    } as T;
  }

  private normalizeListItem(
    asset: PublicAssetListItem,
  ): PublicAssetListItem {
    return {
      ...asset,
      snapshot: {
        ...asset.snapshot,
        ...(asset.snapshot.coverResourcePath
          ? {
              coverResourcePath: this.client.resolveServerPath(
                asset.snapshot.coverResourcePath,
              ),
            }
          : {}),
      },
    };
  }

  private normalizeDraft(draft: PublicAssetDraft): PublicAssetDraft {
    return {
      ...draft,
      snapshot: normalizeSnapshot(this.client, draft.snapshot),
    };
  }
}

function normalizeSnapshot(
  client: ApiClient,
  snapshot: PublicAssetSnapshot,
): PublicAssetSnapshot {
  const detail =
    snapshot.type === "prime-figure"
      ? {
          ...snapshot.detail,
          referenceImages: snapshot.detail.referenceImages.map((image) => ({
            ...image,
            resourcePath:
              client.resolveServerPath(image.resourcePath) ??
              image.resourcePath,
          })),
          stickers: (snapshot.detail.stickers ?? []).map((sticker) => ({
            ...sticker,
            resourcePath:
              client.resolveServerPath(sticker.resourcePath) ??
              sticker.resourcePath,
          })),
        }
      : snapshot.detail;
  return {
    ...snapshot,
    ...(snapshot.avatarResourcePath
      ? {
          avatarResourcePath: client.resolveServerPath(
            snapshot.avatarResourcePath,
          ),
        }
      : {}),
    ...(snapshot.coverResourcePath
      ? {
          coverResourcePath: client.resolveServerPath(
            snapshot.coverResourcePath,
          ),
        }
      : {}),
    detail,
  } as PublicAssetSnapshot;
}
