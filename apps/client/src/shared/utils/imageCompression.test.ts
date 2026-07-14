import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compressImageToJpeg,
  MAX_IMAGE_UPLOAD_BYTES,
} from "./imageCompression";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image compression", () => {
  it("converts supported images to a white-backed JPEG", async () => {
    const operations: string[] = [];
    installImageMocks({
      width: 800,
      height: 600,
      encode: () => 1_024,
      operations,
    });

    const result = await compressImageToJpeg(
      new File([Uint8Array.from([1])], "portrait.png", {
        type: "image/png",
        lastModified: 123,
      }),
    );

    expect(result.name).toBe("portrait.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.lastModified).toBe(123);
    expect(operations).toEqual(["fill:#ffffff", "draw"]);
  });

  it("reduces JPEG quality until the result is no larger than 5 MiB", async () => {
    const encodedSizes: number[] = [];
    installImageMocks({
      width: 3_000,
      height: 2_000,
      encode: (quality) => {
        const size =
          quality > 0.65
            ? MAX_IMAGE_UPLOAD_BYTES + 1
            : MAX_IMAGE_UPLOAD_BYTES - 1;
        encodedSizes.push(size);
        return size;
      },
    });

    const result = await compressImageToJpeg(
      new File([Uint8Array.from([1])], "large.webp", {
        type: "image/webp",
      }),
    );

    expect(encodedSizes.some((size) => size > MAX_IMAGE_UPLOAD_BYTES)).toBe(
      true,
    );
    expect(result.size).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
    expect(result.type).toBe("image/jpeg");
  });

  it("rejects unsupported input before decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    await expect(
      compressImageToJpeg(
        new File([Uint8Array.from([1])], "vector.svg", {
          type: "image/svg+xml",
        }),
      ),
    ).rejects.toThrow("JPEG、PNG、WebP 或 GIF");
    expect(decode).not.toHaveBeenCalled();
  });
});

function installImageMocks(input: {
  width: number;
  height: number;
  encode: (quality: number) => number;
  operations?: string[];
}) {
  const operations = input.operations ?? [];
  const context = {
    fillStyle: "",
    fillRect: () => operations.push(`fill:${context.fillStyle}`),
    drawImage: () => operations.push("draw"),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: BlobCallback, type?: string, quality?: number) => {
      callback(
        new Blob([new Uint8Array(input.encode(quality ?? 1))], {
          type: type ?? "image/jpeg",
        }),
      );
    },
  };
  vi.stubGlobal("document", {
    createElement: () => canvas,
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width: input.width,
      height: input.height,
      close: vi.fn(),
    })),
  );
}
