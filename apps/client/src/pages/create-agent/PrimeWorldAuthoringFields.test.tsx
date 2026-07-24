import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultPrimeWorldDetail } from "@echoo/shared";
import {
  PrimeWorldBundleInput,
  PrimeWorldMetadataFields,
  parsePrimeWorldBundleText,
} from "./PrimeWorldAuthoringFields";

describe("Prime World authoring fields", () => {
  it("parses a bundle without creating anything", () => {
    const detail = createDefaultPrimeWorldDetail();
    const bundle = parsePrimeWorldBundleText(JSON.stringify({
      format: "echoo-prime-world",
      formatVersion: 1,
      name: "雾港",
      attributes: [{ key: "时代", value: "未来" }],
      tags: ["冒险", "群像"],
      introduction: "一座会改变的港口。",
      isPublic: false,
      detail,
      resources: [],
    }));
    expect(bundle.name).toBe("雾港");
    expect(bundle.tags).toEqual(["冒险", "群像"]);
    expect(bundle.detail).toEqual(detail);
  });

  it("renders bundle guidance before button-based metadata fields", () => {
    const html = renderToStaticMarkup(
      <>
        <PrimeWorldBundleInput value="" onChange={() => undefined} onApply={() => undefined} />
        <PrimeWorldMetadataFields
          name=""
          tags={["冒险"]}
          introduction=""
          onNameChange={() => undefined}
          onTagsChange={() => undefined}
          onIntroductionChange={() => undefined}
        />
      </>,
    );
    expect(html.indexOf("如果你有导出的 bundle JSON")).toBeLessThan(html.indexOf("世界名称"));
    expect(html).toContain("应用 bundle JSON");
    expect(html).toContain("添加标签");
    expect(html).toContain("删除标签 1");
  });
});
