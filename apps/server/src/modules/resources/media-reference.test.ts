import assert from "node:assert/strict";
import test from "node:test";
import { messageContentSchema } from "@echoo/shared";
import { createVisualMediaReference } from "./media-reference.js";

test("creates visual media references without dimensions", () => {
  for (const kind of ["image", "sticker", "video"] as const) {
    assert.deepEqual(
      createVisualMediaReference({
        resourceId: `resource_${kind}`,
        kind,
        variants: ["display", "original"],
      }),
      {
        resourceId: `resource_${kind}`,
        kind,
        variants: ["display", "original"],
      },
    );
  }
});

test("message validation rejects obsolete visual dimension fields", () => {
  assert.equal(
    messageContentSchema.safeParse({
      media: {
        resourceId: "resource_image",
        kind: "image",
        variants: ["display"],
        width: 160,
        height: 90,
      },
    }).success,
    false,
  );
});
