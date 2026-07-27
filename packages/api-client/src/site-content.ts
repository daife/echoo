import type {
  SiteContentView,
  UpdateSiteContentRequest,
} from "@echoo/shared/site-content";
import type { ApiClient } from "./client";

export class SiteContentApi {
  constructor(private readonly client: ApiClient) {}

  get(options?: { signal?: AbortSignal }) {
    return this.client.get<SiteContentView>(
      "/site-content",
      undefined,
      options,
    );
  }

  update(input: UpdateSiteContentRequest) {
    return this.client.patch<SiteContentView>("/admin/site-content", input);
  }
}
