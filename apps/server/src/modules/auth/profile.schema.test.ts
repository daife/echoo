import assert from "node:assert/strict";
import test from "node:test";
import { updateUserProfileSchema } from "@echoo/shared";

test("profile update trims nickname and signature", () => {
  assert.deepEqual(
    updateUserProfileSchema.parse({
      displayName: "  Aether  ",
      signature: "  安静地共创角色。  ",
    }),
    { displayName: "Aether", signature: "安静地共创角色。" },
  );
});

test("profile update accepts avatar replacement and removal", () => {
  assert.equal(
    updateUserProfileSchema.safeParse({
      avatar: {
        fileName: "avatar.jpg",
        mimeType: "image/jpeg",
        dataBase64: "base64",
      },
    }).success,
    true,
  );
  assert.equal(updateUserProfileSchema.safeParse({ avatar: null }).success, true);
});

test("profile update rejects empty patches and invalid text", () => {
  assert.equal(updateUserProfileSchema.safeParse({}).success, false);
  assert.equal(
    updateUserProfileSchema.safeParse({ displayName: "   " }).success,
    false,
  );
  assert.equal(
    updateUserProfileSchema.safeParse({ signature: "x".repeat(161) }).success,
    false,
  );
});
