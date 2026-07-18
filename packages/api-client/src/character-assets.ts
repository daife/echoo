import type {
  CharacterAssetDetail,
  CharacterAssetDraft,
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
  SocialComment,
  SocialCommentPage,
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
      sort?: "quality" | "latest";
    } = {},
  ): Promise<CharacterAssetPage> {
    return this.client
      .get<CharacterAssetPage>("/character-assets", input)
      .then((page) => ({
        ...page,
        items: page.items.map((asset) => this.normalizeAsset(asset)),
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

  like(objectId: string) {
    return this.client.put<{ likeCount: number; viewerHasLiked: boolean }>(
      `/social/objects/${objectId}/like`,
    );
  }

  unlike(objectId: string) {
    return this.client.delete<{
      likeCount: number;
      viewerHasLiked: boolean;
    }>(`/social/objects/${objectId}/like`);
  }

  listComments(objectId: string, before?: string, limit = 30) {
    return this.client.get<SocialCommentPage>(
      `/social/objects/${objectId}/comments`,
      { before, limit },
    );
  }

  createComment(objectId: string, body: string, parentCommentId?: string) {
    return this.client.post<SocialComment>(
      `/social/objects/${objectId}/comments`,
      { body, ...(parentCommentId ? { parentCommentId } : {}) },
    );
  }

  updateComment(commentId: string, body: string) {
    return this.client.patch<SocialComment>(`/social/comments/${commentId}`, {
      body,
    });
  }

  deleteComment(commentId: string) {
    return this.client.delete<{ ok: true }>(`/social/comments/${commentId}`);
  }

  hideComment(commentId: string) {
    return this.client.post<{ ok: true }>(`/social/comments/${commentId}/hide`);
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
