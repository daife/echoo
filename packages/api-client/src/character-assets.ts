import type {
  CharacterAssetDetail,
  CharacterAssetDraft,
  CharacterAssetListItem,
  CharacterAssetPage,
  CharacterAssetSnapshot,
  CharacterAssetSummary,
  CreateCharacterAssetDraftRequest,
  InstallCharacterAssetResponse,
  InstallCharacterAssetRequest,
  PublishCharacterAssetResponse,
  SaveCharacterAssetRecommendationRequest,
  CreatePrimeFigureRequest,
  CreateSliceFigureRequest,
} from "@echoo/shared";
import { normalizeAgentResources } from "./agents";
import type { ApiClient } from "./client";

export class CharacterAssetsApi {
  constructor(private readonly client: ApiClient) {}

  list(
    input: {
      limit?: number;
      cursor?: string;
      q?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<CharacterAssetPage> {
    const { signal, ...query } = input;
    return this.client
      .get<CharacterAssetPage>("/character-assets", query, { signal })
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeListItem(asset)),
      }));
  }

  listFeatured(
    input: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<CharacterAssetListItem[]> {
    const { signal, ...query } = input;
    return this.client
      .get<CharacterAssetListItem[]>(
        "/character-assets/featured",
        query,
        { signal },
      )
      .then((items) => items.map((asset) => this.normalizeListItem(asset)));
  }

  listByUser(userId: string, input: { limit?: number; cursor?: string } = {}) {
    return this.client
      .get<CharacterAssetPage>(`/users/${userId}/character-assets`, input)
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeListItem(asset)),
      }));
  }

  listFollowing(input: { limit?: number; cursor?: string } = {}) {
    return this.client
      .get<CharacterAssetPage>("/feeds/following/character-assets", input)
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeListItem(asset)),
      }));
  }

  get(assetId: string): Promise<CharacterAssetDetail> {
    return this.client
      .get<CharacterAssetDetail>(`/character-assets/${assetId}`)
      .then((asset) => this.normalizeAsset(asset));
  }

  unlist(assetId: string) {
    return this.client.post<{ ok: true }>(
      `/character-assets/${assetId}/unlist`,
    );
  }

  delete(assetId: string) {
    return this.client.delete<{ ok: true }>(`/character-assets/${assetId}`);
  }

  install(
    assetId: string,
    input: InstallCharacterAssetRequest,
  ): Promise<InstallCharacterAssetResponse> {
    return this.client
      .post<InstallCharacterAssetResponse>(
        `/character-assets/${assetId}/install`,
        input,
      )
      .then((response) => ({
        ...response,
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  updateInstallation(
    assetId: string,
    input: InstallCharacterAssetRequest,
  ): Promise<InstallCharacterAssetResponse> {
    return this.client
      .post<InstallCharacterAssetResponse>(
        `/character-assets/${assetId}/install/update`,
        input,
      )
      .then((response) => ({
        ...response,
        agent: normalizeAgentResources(this.client, response.agent),
      }));
  }

  createDraft(
    input: CreateCharacterAssetDraftRequest,
  ): Promise<CharacterAssetDraft> {
    return this.client
      .post<CharacterAssetDraft>("/character-assets/drafts", input)
      .then((draft) => this.normalizeDraft(draft));
  }

  listMine(): Promise<CharacterAssetDraft[]> {
    return this.client
      .get<CharacterAssetDraft[]>("/users/me/character-assets")
      .then((drafts) => drafts.map((draft) => this.normalizeDraft(draft)));
  }

  getDraft(assetId: string): Promise<CharacterAssetDraft> {
    return this.client
      .get<CharacterAssetDraft>(`/character-assets/${assetId}/draft`)
      .then((draft) => this.normalizeDraft(draft));
  }

  saveDraftCharacter(
    assetId: string,
    input: CreateSliceFigureRequest | CreatePrimeFigureRequest,
  ): Promise<CharacterAssetDraft> {
    return this.client
      .patch<CharacterAssetDraft>(
        `/character-assets/${assetId}/draft/character`,
        input,
      )
      .then((draft) => this.normalizeDraft(draft));
  }

  saveDraftRecommendation(
    assetId: string,
    input: SaveCharacterAssetRecommendationRequest,
  ): Promise<CharacterAssetDraft> {
    return this.client
      .patch<CharacterAssetDraft>(
        `/character-assets/${assetId}/draft/recommendation`,
        input,
      )
      .then((draft) => this.normalizeDraft(draft));
  }

  publishDraft(assetId: string): Promise<PublishCharacterAssetResponse> {
    return this.client
      .post<PublishCharacterAssetResponse>(
        `/character-assets/${assetId}/publish`,
      )
      .then((response) => ({
        ...response,
        asset: this.normalizeAsset(response.asset),
      }));
  }

  private normalizeAsset<T extends CharacterAssetSummary>(asset: T): T {
    const snapshot = normalizeSnapshot(this.client, asset.snapshot);
    return {
      ...asset,
      snapshot,
      ...("latestVersion" in asset
        ? {
            latestVersion: {
              ...(asset as CharacterAssetDetail).latestVersion,
              snapshot,
            },
          }
        : {}),
    } as T;
  }

  private normalizeListItem(
    asset: CharacterAssetListItem,
  ): CharacterAssetListItem {
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

  private normalizeDraft(draft: CharacterAssetDraft): CharacterAssetDraft {
    return {
      ...draft,
      snapshot: normalizeSnapshot(this.client, draft.snapshot),
    };
  }
}

function normalizeSnapshot(
  client: ApiClient,
  snapshot: CharacterAssetSnapshot,
): CharacterAssetSnapshot {
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
  } as CharacterAssetSnapshot;
}
