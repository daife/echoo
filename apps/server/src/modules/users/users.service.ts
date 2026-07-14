export class UsersService {
  getCurrentUser(userId: string) {
    return {
      id: userId,
      email: "demo@echoo.local",
      displayName: "Echoo User",
      createdAt: Date.now(),
    };
  }
}
