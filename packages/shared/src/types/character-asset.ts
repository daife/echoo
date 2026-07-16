import type {
  Agent,
  AgentAttribute,
  AgentType,
  PrimeFigureDetail,
  SliceFigureDetail,
} from "./agent.js";

export type CharacterAssetType = Exclude<AgentType, "prime-world">;
export type CharacterAssetStatus = "published" | "unlisted";

export interface CharacterAssetSnapshotBase {
  type: CharacterAssetType;
  name: string;
  avatarResourceId?: string;
  avatarResourcePath?: string;
  coverResourceId?: string;
  coverResourcePath?: string;
  attributes: AgentAttribute[];
  tags: string[];
  introduction: string;
}

export type CharacterAssetSnapshot =
  | (CharacterAssetSnapshotBase & {
      type: "slice-figure";
      detail: SliceFigureDetail;
    })
  | (CharacterAssetSnapshotBase & {
      type: "prime-figure";
      detail: PrimeFigureDetail;
    });

export interface PublishedRuntimeRecommendation {
  version: 1;
  characterType: CharacterAssetType;
  config: Record<string, unknown>;
}

export interface CharacterAssetVersion {
  id: string;
  assetId: string;
  versionNumber: number;
  snapshot: CharacterAssetSnapshot;
  recommendedRuntimeConfig?: PublishedRuntimeRecommendation;
  createdAt: number;
}

export interface CharacterAssetSummary {
  id: string;
  author: { id: string; displayName: string };
  status: CharacterAssetStatus;
  latestVersionId: string;
  latestVersionNumber: number;
  snapshot: CharacterAssetSnapshot;
  hasRecommendedRuntimeConfig: boolean;
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  installedVersionId?: string;
  installedVersionNumber?: number;
  installationId?: string;
  updateAvailable: boolean;
  publishedAt: number;
  updatedAt: number;
}

export interface CharacterAssetDetail extends CharacterAssetSummary {
  latestVersion: CharacterAssetVersion;
}

export interface PublishCharacterAssetRequest {
  includeRecommendedRuntimeConfig: boolean;
}

export interface PublishCharacterAssetResponse {
  asset: CharacterAssetDetail;
  warning?: "CUSTOM_RUNTIME_CONFIG_REMOVED";
}

export interface InstallCharacterAssetResponse {
  agent: Agent;
  installationId: string;
  installedVersionId: string;
}

export interface InstallCharacterAssetRequest {
  applyRecommendedRuntimeConfig: boolean;
}

export interface SocialComment {
  id: string;
  objectId: string;
  author: { id: string; displayName: string };
  parentCommentId?: string;
  body: string;
  status: "visible" | "deleted" | "hidden";
  canEdit: boolean;
  canDelete: boolean;
  canHide: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SocialCommentPage {
  items: SocialComment[];
  nextCursor?: string;
}
