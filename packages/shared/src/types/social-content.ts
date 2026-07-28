export interface SocialPostTextContentInput {
  type: "text";
  text: string;
}

export interface SocialPostMediaContentInput {
  type: "image" | "audio";
  resourceId: string;
}

export type SocialPostContentInput =
  | SocialPostTextContentInput
  | SocialPostMediaContentInput;

export interface SocialPostTextContent {
  type: "text";
  text: string;
}

export interface SocialPostImageContent {
  type: "image";
  resourceId: string;
  resourcePath: string;
}

export interface SocialPostAudioContent {
  type: "audio";
  resourceId: string;
  resourcePath: string;
  durationSeconds: number;
}

export type SocialPostContent =
  | SocialPostTextContent
  | SocialPostImageContent
  | SocialPostAudioContent;
