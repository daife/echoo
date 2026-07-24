import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavigationLayer } from "./BackNavigationProvider";

describe("NavigationLayer", () => {
  it("preserves the viewport height chain for active pages", () => {
    const markup = renderToStaticMarkup(
      <NavigationLayer active>
        <section>聊天页</section>
      </NavigationLayer>,
    );

    expect(markup).toContain('class="h-full min-h-0"');
    expect(markup).not.toContain("hidden");
  });

  it("keeps inactive pages mounted but hidden", () => {
    const markup = renderToStaticMarkup(
      <NavigationLayer active={false}>
        <section>详情页</section>
      </NavigationLayer>,
    );

    expect(markup).toContain("hidden");
    expect(markup).toContain('aria-hidden="true"');
  });
});
