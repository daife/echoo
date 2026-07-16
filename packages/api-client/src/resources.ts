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

  upload(ticket: MediaUploadTicket, blob: Blob) {
    return this.client.putBinary(ticket.uploadUrl, blob, ticket.uploadHeaders);
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
