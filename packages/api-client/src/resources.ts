import type {
  MediaAccessItem,
  MediaResourceStatus,
  MediaUploadTicket,
  MediaVariant,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class ResourcesApi {
  constructor(private readonly client: ApiClient) {}

  createUpload(input: {
    kind: "end_user_image" | "end_user_voice" | "end_user_video";
    fileName: string;
    mimeType:
      | "image/jpeg"
      | "audio/mpeg"
      | "video/mp4"
      | "video/webm"
      | "video/quicktime"
      | "video/mov"
      | "video/mpeg";
    byteSize: number;
  }) {
    return this.client.post<MediaUploadTicket>("/resources/uploads", input);
  }

  async upload(ticket: MediaUploadTicket, blob: Blob) {
    try {
      await this.client.putBinary(
        ticket.uploadUrl,
        blob,
        ticket.uploadHeaders,
      );
    } catch (error) {
      // A presigned object-storage URL can reject an embedded WebView origin even
      // when the same bucket CORS policy accepts the public web application.
      // The authenticated API upload route is deliberately kept as a fallback
      // for native shells and for temporarily unavailable direct uploads.
      if (!/^https?:\/\//i.test(ticket.uploadUrl)) throw error;
      await this.client.putBinary(
        `resources/${ticket.resourceId}/content`,
        blob,
        { "Content-Type": "application/octet-stream" },
      );
    }
  }

  complete(resourceId: string) {
    return this.client.post<{ resourceId: string; status: string }>(
      `/resources/${resourceId}/complete`,
    );
  }

  status(resourceId: string) {
    return this.client.get<MediaResourceStatus>(`/resources/${resourceId}`);
  }

  async access(items: Array<{ resourceId: string; variant: MediaVariant }>) {
    const response = await this.client.post<{
      items: Array<MediaAccessItem | { resourceId: string; error: string }>;
    }>("/resources/access", { items });
    return response.items.filter(
      (item): item is MediaAccessItem => "url" in item,
    );
  }
}
