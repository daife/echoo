import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JsonImport, readJsonImportFile } from "./JsonImport";

function file(name: string, value: string, failure?: Error) {
  return {
    name,
    text: failure
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(value),
  };
}

describe("JsonImport", () => {
  it("renders file selection, drop-target guidance, and the explicit apply action", () => {
    const html = renderToStaticMarkup(
      <JsonImport
        value=""
        placeholder="JSON"
        onChange={() => undefined}
        onApply={() => undefined}
      />,
    );

    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain("选择 JSON 文件");
    expect(html).toContain("拖到下方输入框");
    expect(html).toContain('data-drag-active="false"');
    expect(html).toContain("应用 JSON");
  });

  it("reads a selected JSON file without applying or parsing it", async () => {
    const source = '{"type":"slice-figure","name":"Mira"}';
    await expect(readJsonImportFile([file("slice.json", source)])).resolves.toBe(
      source,
    );
  });

  it("uses the first JSON file when dropped files include other formats", async () => {
    const source = '{"type":"prime-figure","name":"Nova"}';
    await expect(
      readJsonImportFile([
        file("notes.txt", "ignored"),
        file("prime.JSON", source),
        file("other.json", "ignored"),
      ]),
    ).resolves.toBe(source);
  });

  it.each([
    ["slice-figure", "Mira"],
    ["prime-figure", "Nova"],
  ])("provides valid imported %s JSON to the existing apply flow", async (type, name) => {
    const value = await readJsonImportFile([
      file(`${type}.json`, JSON.stringify({ type, name })),
    ]);

    expect(JSON.parse(value)).toEqual({ type, name });
  });

  it("rejects non-JSON files before changing form content", async () => {
    await expect(
      readJsonImportFile([file("notes.txt", "plain")]),
    ).rejects.toThrow("请选择 .json 文件");
  });

  it("reports file read failures", async () => {
    await expect(
      readJsonImportFile([file("broken.json", "", new Error("read failed"))]),
    ).rejects.toThrow("无法读取 JSON 文件");
  });

  it("leaves invalid JSON detection to the existing apply action", async () => {
    const value = await readJsonImportFile([file("invalid.json", "{")]);
    expect(() => JSON.parse(value)).toThrow();
  });
});
