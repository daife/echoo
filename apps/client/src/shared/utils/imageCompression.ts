import type { AgentResourceUpload } from "@echoo/shared";

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_INITIAL_DIMENSION = 4_096;
const MIN_JPEG_QUALITY = 0.35;
const MAX_JPEG_QUALITY = 0.9;
const QUALITY_SEARCH_STEPS = 5;
const RESIZE_FACTOR = 0.8;
const MAX_RESIZE_ATTEMPTS = 12;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
}

export async function compressImageToJpeg(file: File): Promise<File> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type))
    throw new Error("请选择 JPEG、PNG、WebP 或 GIF 图片。");

  const decoded = await decodeImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("当前环境无法处理图片。");

    const initialScale = Math.min(
      1,
      MAX_INITIAL_DIMENSION / Math.max(decoded.width, decoded.height),
    );
    let width = Math.max(1, Math.round(decoded.width * initialScale));
    let height = Math.max(1, Math.round(decoded.height * initialScale));

    for (let attempt = 0; attempt < MAX_RESIZE_ATTEMPTS; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);

      const blob = await encodeWithinLimit(canvas);
      if (blob)
        return new File([blob], toJpegFileName(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });

      if (width === 1 && height === 1) break;
      width = Math.max(1, Math.floor(width * RESIZE_FACTOR));
      height = Math.max(1, Math.floor(height * RESIZE_FACTOR));
    }

    throw new Error("图片压缩后仍超过 5MB，请选择分辨率更低的图片。");
  } finally {
    decoded.dispose();
  }
}

export async function imageFileToUpload(
  file: File,
): Promise<AgentResourceUpload> {
  const compressed = await compressImageToJpeg(file);
  return {
    fileName: compressed.name,
    mimeType: "image/jpeg",
    dataBase64: await readBlobAsBase64(compressed),
  };
}

async function encodeWithinLimit(canvas: HTMLCanvasElement) {
  const highestQuality = await canvasToJpeg(canvas, MAX_JPEG_QUALITY);
  if (highestQuality.size <= MAX_IMAGE_UPLOAD_BYTES) return highestQuality;

  const lowestQuality = await canvasToJpeg(canvas, MIN_JPEG_QUALITY);
  if (lowestQuality.size > MAX_IMAGE_UPLOAD_BYTES) return null;

  let best = lowestQuality;
  let low = MIN_JPEG_QUALITY;
  let high = MAX_JPEG_QUALITY;
  for (let step = 0; step < QUALITY_SEARCH_STEPS; step += 1) {
    const quality = (low + high) / 2;
    const candidate = await canvasToJpeg(canvas, quality);
    if (candidate.size <= MAX_IMAGE_UPLOAD_BYTES) {
      best = candidate;
      low = quality;
    } else {
      high = quality;
    }
  }
  return best;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片压缩失败。"));
      },
      "image/jpeg",
      quality,
    );
  });
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Fall back to an HTMLImageElement for runtimes with partial bitmap support.
    }
  }

  return await new Promise<DecodedImage>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => URL.revokeObjectURL(objectUrl),
      });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片无法解码或文件已损坏。"));
    };
    image.src = objectUrl;
  });
}

function readBlobAsBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const dataBase64 = result.slice(result.indexOf(",") + 1);
      if (dataBase64) resolve(dataBase64);
      else reject(new Error("图片读取失败。"));
    };
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function toJpegFileName(fileName: string) {
  const trimmed = fileName.trim();
  const baseName = trimmed.replace(/\.[^./\\]+$/, "") || "image";
  return `${baseName}.jpg`;
}
