import { describe, expect, it } from "vitest";
import { buildPrologueDocument } from "./prologueDocument";

describe("buildPrologueDocument", () => {
  it("disables gesture scaling inside the sandboxed document", () => {
    const document = buildPrologueDocument("<p>序引</p>");

    expect(document).toContain("maximum-scale=1.0");
    expect(document).toContain("user-scalable=no");
    expect(document).toContain("touch-action: pan-x pan-y");
    expect(document).toMatch(/addEventListener\(\s*"wheel"/);
    expect(document).toMatch(/addEventListener\(\s*"gesturestart"/);
    expect(document).toContain("<p>序引</p>");
  });
});
