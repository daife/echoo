import type {
  CharacterAssetDetail,
  CharacterAssetSnapshot,
  CharacterAssetSummary,
  InstallCharacterAssetResponse,
  InstallCharacterAssetRequest,
  PublishCharacterAssetRequest,
  PublishCharacterAssetResponse,
  SocialComment,
  SocialCommentPage,
} from "@echoo/shared";
import { normalizeAgentResources } from "./agents";
import type { ApiClient } from "./client";

export class CharacterAssetsApi {
  constructor(private readonly client: ApiClient) {}

  list(limit = 50): Promise<CharacterAssetSummary[]> {
    return this.client
      .get<CharacterAssetSummary[]>("/character-assets", { limit })
      .then((assets) => assets.map((asset) => this.normalizeAsset(asset)));
  }

  get(assetId: string): Promise<CharacterAssetDetail> {
    return this.client
      .get<CharacterAssetDetail>(`/character-assets/${assetId}`)
      .then((asset) => this.normalizeAsset(asset));
  }

  publish(
    agentId: string,
    input: PublishCharacterAssetRequest,
  ): Promise<PublishCharacterAssetResponse> {
    return this.client
      .post<PublishCharacterAssetResponse>(`/agents/${agentId}/publish`, input)
      .then((response) => ({
        ...response,
        asset: this.normalizeAsset(response.asset),
      }));
  }

  unlist(assetId: string) {
    return this.client.post<{ ok: true }>(
      `/character-assets/${assetId}/unlist`,
    );
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

  updateInstallation(assetId: string): Promise<InstallCharacterAssetResponse> {
    return this.client
      .post<InstallCharacterAssetResponse>(
        `/character-assets/${assetId}/install/update`,
      )
      .then((response) => ({
        ...response,
        agent: normalizeAgentResources(this.client, response.agent),
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
