import type { SiteContentApi } from "@echoo/api-client";

export class SiteContentService {
  constructor(private readonly api: SiteContentApi) {}

  get(options?: { signal?: AbortSignal }) {
    return this.api.get(options);
  }
}
