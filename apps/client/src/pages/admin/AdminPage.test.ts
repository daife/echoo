import { describe, expect, it } from "vitest";
import { filterDefaultFollowCandidates, type AdminUser } from "./AdminPage";

const baseUser: AdminUser = {
  id: "user_1",
  email: "user@example.test",
  displayName: "User",
  balanceUsd: "0",
  createdAt: 1,
  isAdmin: false,
  isDefaultFollow: false,
};

describe("admin account management", () => {
  it("only offers administrator accounts as default-follow candidates", () => {
    const administrator = {
      ...baseUser,
      id: "admin_1",
      isAdmin: true,
    };
    expect(filterDefaultFollowCandidates([baseUser, administrator])).toEqual([
      administrator,
    ]);
  });
});
