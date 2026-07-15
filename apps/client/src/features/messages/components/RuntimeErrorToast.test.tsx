import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_ERROR_TOAST_DURATION_MS,
  RuntimeErrorToast,
} from "./RuntimeErrorToast";

describe("RuntimeErrorToast", () => {
  it("renders the latest runtime error outside the message timeline", () => {
    const html = renderToStaticMarkup(
      <RuntimeErrorToast
        notice={{
          id: "msg_error",
          text: "openrouter chat completion failed: No endpoints available.",
        }}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toContain(
      "运行失败：openrouter chat completion failed: No endpoints available.",
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="关闭运行失败提示"');
  });

  it("uses the six-second display duration", () => {
    expect(RUNTIME_ERROR_TOAST_DURATION_MS).toBe(6_000);
  });
});
