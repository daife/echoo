export interface SocialAuthor {
  id: string;
  displayName: string;
  avatarUrl?: string;
  isAdmin: boolean;
}

export interface SocialComment {
  id: string;
  objectId: string;
  author: SocialAuthor;
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

export interface SocialPostImage {
  resourceId: string;
  resourcePath: string;
  position: number;
}

export interface SocialPostSummary {
  id: string;
  author: SocialAuthor;
  body: string;
  images: SocialPostImage[];
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SocialPostDetail = SocialPostSummary;

export interface SocialPostPage {
  items: SocialPostSummary[];
  nextCursor?: string;
}

export interface CreateSocialPostRequest {
  body?: string;
  resourceIds?: string[];
}

export type UpdateSocialPostRequest = CreateSocialPostRequest;

export interface PublicUserProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
  isAdmin: boolean;
  signature: string;
  createdAt: number;
  followerCount: number;
  followingCount: number;
  viewerIsFollowing: boolean;
  followsViewer: boolean;
  isMutual: boolean;
  isSelf: boolean;
}

export interface PublicUserPage {
  items: PublicUserProfile[];
  nextCursor?: string;
}

export interface FollowMutationResult {
  following: boolean;
  followerCount: number;
  isMutual: boolean;
}
