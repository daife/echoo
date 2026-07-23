import type {
  Agent,
  AgentAttribute,
  AgentType,
  PrimeFigureDetail,
  PrimeWorldDetail,
  SliceFigureDetail,
} from "../../types/agent.js";

export type PublicAssetType = AgentType;
export type PublicAssetStatus = "draft" | "published" | "unlisted";

export type CreatePublicAssetDraftRequest =
  | { type: PublicAssetType; importFromOriginalAgentId?: never }
  | { importFromOriginalAgentId: string; type?: never };

export interface PublicAssetSnapshotBase {
  type: PublicAssetType;
  name: string;
  avatarResourceId?: string;
  avatarResourcePath?: string;
  coverResourceId?: string;
  coverResourcePath?: string;
  attributes: AgentAttribute[];
  tags: string[];
  introduction: string;
}

export type PublicAssetSnapshot =
  | (PublicAssetSnapshotBase & {
      type: "slice-figure";
      detail: SliceFigureDetail;
    })
  | (PublicAssetSnapshotBase & {
      type: "prime-figure";
      detail: PrimeFigureDetail;
    })
  | (PublicAssetSnapshotBase & {
      type: "prime-world";
      detail: PrimeWorldDetail;
    });

export interface PublishedRuntimeRecommendation {
  version: 1;
  assetType: PublicAssetType;
  config: Record<string, unknown>;
}

export interface PublicAssetVersion {
  id: string;
  assetId: string;
  versionNumber: number;
  snapshot: PublicAssetSnapshot;
  recommendedRuntimeConfig?: PublishedRuntimeRecommendation;
  createdAt: number;
}

export interface PublicAssetSummary {
  id: string;
  author: { id: string; displayName: string };
  status: PublicAssetStatus;
  latestVersionId: string;
  latestVersionNumber: number;
  snapshot: PublicAssetSnapshot;
  hasRecommendedRuntimeConfig: boolean;
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  installedVersionId?: string;
  installedVersionNumber?: number;
  installationId?: string;
  worldProgressCompatibility?: {
    canPreserve: boolean;
    reason?: string;
  };
  updateAvailable: boolean;
  publishedAt: number;
  updatedAt: number;
}

export interface PublicAssetListItem {
  id: string;
  author: { id: string; displayName: string };
  latestVersionNumber: number;
  snapshot: {
    type: PublicAssetType;
    name: string;
    coverResourcePath?: string;
    attributes: AgentAttribute[];
    tags: string[];
    preview: string;
  };
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  installedVersionId?: string;
  installedVersionNumber?: number;
  installationId?: string;
  updateAvailable: boolean;
  publishedAt: number;
}

export interface PublicAssetDetail extends PublicAssetSummary {
  latestVersion: PublicAssetVersion;
}

export interface PublicAssetPage {
  items: PublicAssetListItem[];
  nextCursor?: string;
}

export interface PublicAssetDraft {
  id: string;
  author: { id: string; displayName: string };
  status: PublicAssetStatus;
  snapshot: PublicAssetSnapshot;
  recommendedRuntimeConfig?: PublishedRuntimeRecommendation;
  latestVersionId?: string;
  latestVersionNumber?: number;
  hasUnpublishedChanges: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SavePublicAssetRecommendationRequest {
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface PublishPublicAssetResponse {
  asset: PublicAssetDetail;
}

export interface InstallPublicAssetResponse {
  agent: Agent;
  installationId: string;
  installedVersionId: string;
}

export interface InstallPublicAssetRequest {
  applyRecommendedRuntimeConfig: boolean;
  worldProgressStrategy?: "preserve-compatible" | "reset";
}
