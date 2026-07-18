import { UserSocialRepository } from "./user-social.repository.js";

export class PublicUserNotFoundError extends Error {}
export class FollowForbiddenError extends Error {}

export class UsersService {
  constructor(private readonly users = new UserSocialRepository()) {}

  async getPublicProfile(viewerUserId: string | null, userId: string) {
    const profile = await this.users.findProfile(viewerUserId, userId);
    if (!profile) throw new PublicUserNotFoundError("用户不存在。");
    return profile;
  }

  async setFollowing(viewerUserId: string, userId: string, following: boolean) {
    if (viewerUserId === userId)
      throw new FollowForbiddenError("不能关注自己。");
    const result = await this.users.setFollowing(
      viewerUserId,
      userId,
      following,
    );
    if (!result) throw new PublicUserNotFoundError("用户不存在。");
    return result;
  }

  async listFollowers(
    viewerUserId: string | null,
    userId: string,
    limit: number,
    cursor?: string,
  ) {
    await this.getPublicProfile(viewerUserId, userId);
    return this.users.listRelations(
      viewerUserId,
      userId,
      "followers",
      limit,
      cursor,
    );
  }

  async listFollowing(
    viewerUserId: string | null,
    userId: string,
    limit: number,
    cursor?: string,
  ) {
    await this.getPublicProfile(viewerUserId, userId);
    return this.users.listRelations(
      viewerUserId,
      userId,
      "following",
      limit,
      cursor,
    );
  }
}
