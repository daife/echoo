import { ApiClient } from "@echoo/api-client";

export const httpClient = new ApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api"
});
