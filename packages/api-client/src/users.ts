import type {
  FollowMutationResult,
  PublicUserPage,
  PublicUserProfile,
} from "@echoo/shared";
import type { ApiClient } from "./client";

export class UsersApi {
  constructor(private readonly client: ApiClient) {}

  get(userId: string) {
    return this.client
      .get<PublicUserProfile>(`/users/${userId}`)
      .then((profile) => this.normalize(profile));
  }
  setFollowing(userId: string, following: boolean) {
    return following
      ? this.client.put<FollowMutationResult>(`/users/${userId}/follow`)
      : this.client.delete<FollowMutationResult>(`/users/${userId}/follow`);
  }
  listFollowers(
    userId: string,
    input: { limit?: number; cursor?: string } = {},
  ) {
    return this.list(`/users/${userId}/followers`, input);
  }
  listFollowing(
    userId: string,
    input: { limit?: number; cursor?: string } = {},
  ) {
    return this.list(`/users/${userId}/following`, input);
  }
  private list(path: string, input: { limit?: number; cursor?: string }) {
    return this.client.get<PublicUserPage>(path, input).then((page) => ({
      ...page,
      items: page.items.map((profile) => this.normalize(profile)),
    }));
  }
  private normalize(profile: PublicUserProfile): PublicUserProfile {
    return {
      ...profile,
      ...(profile.avatarUrl
        ? { avatarUrl: this.client.resolveServerPath(profile.avatarUrl) }
        : {}),
    };
  }
}
