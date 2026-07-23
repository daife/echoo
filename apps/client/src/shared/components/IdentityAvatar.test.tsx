import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdentityAvatar } from "./IdentityAvatar";

describe("IdentityAvatar", () => {
  it("clips both the media wrapper and image into a circle", () => {
    const html = renderToStaticMarkup(
      <IdentityAvatar
        mediaUrl="https://example.test/avatar.png"
        alt="测试头像"
        className="h-20 w-20"
      />,
    );

    expect(html).toContain("relative shrink-0 rounded-full");
    expect(html).toContain("overflow-hidden rounded-full bg-transparent");
    expect(html).toContain("rounded-full object-cover");
  });
});
