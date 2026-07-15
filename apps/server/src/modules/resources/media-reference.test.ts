import assert from "node:assert/strict";
import test from "node:test";
import { messageContentSchema } from "@echoo/shared";
import { createVisualMediaReference } from "./media-reference.js";

test("creates visual media references with stable dimensions", () => {
  for (const kind of ["image", "sticker", "video"] as const) {
    assert.deepEqual(
      createVisualMediaReference({
        resourceId: `resource_${kind}`,
        kind,
        variants: ["display", "original"],
        width: 1_600,
        height: 900,
      }),
      {
        resourceId: `resource_${kind}`,
        kind,
        variants: ["display", "original"],
        width: 1_600,
        height: 900,
      },
    );
  }
});

test("rejects visual media without positive integer dimensions", () => {
  assert.throws(() =>
    createVisualMediaReference({
      resourceId: "resource_image",
      kind: "image",
      variants: ["display"],
      width: 0,
      height: 900,
    }),
  );
  assert.equal(
    messageContentSchema.safeParse({
      media: {
        resourceId: "resource_image",
        kind: "image",
        variants: ["display"],
        width: 100.5,
        height: 90,
      },
    }).success,
    false,
  );
});
