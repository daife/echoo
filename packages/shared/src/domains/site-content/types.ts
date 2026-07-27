export const SITE_ANNOUNCEMENT_MAX_LENGTH = 4000;

export interface SiteContentView {
  announcement: string;
}

export interface UpdateSiteContentRequest {
  announcement: string;
}
