import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, mkdirSync, promises as fsPromises } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Readable } from "node:stream";

export interface StoredObjectInfo {
  size: number;
  etag?: string;
  mimeType?: string;
}

export interface ResourceStorage {
  readonly provider: "local" | "s3";
  put(
    key: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<StoredObjectInfo>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObjectInfo | null>;
  delete(key: string): Promise<void>;
  createReadStream(
    key: string,
    range?: string,
  ): Promise<{
    stream: Readable;
    size: number;
    statusCode: 200 | 206;
    contentRange?: string;
    etag?: string;
  }>;
  signPut(
    key: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<string | null>;
  signGet(key: string, expiresInSeconds: number): Promise<string | null>;
  localUploadPath?(key: string): string;
}

export function createResourceStorage(
  provider: "local" | "s3" = process.env.RESOURCE_STORAGE_PROVIDER === "s3"
    ? "s3"
    : "local",
): ResourceStorage {
  return provider === "s3"
    ? new S3ResourceStorage()
    : new LocalResourceStorage();
}

class LocalResourceStorage implements ResourceStorage {
  readonly provider = "local" as const;
  private readonly root = resolve(
    process.cwd(),
    process.env.RESOURCE_STORAGE_DIR ?? ".data/resources",
  );

  localUploadPath(key: string) {
    return this.path(key);
  }

  async put(key: string, data: Uint8Array, _mimeType: string) {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    await fsPromises.writeFile(path, data);
    return { size: data.byteLength };
  }

  async get(key: string) {
    return fsPromises.readFile(this.path(key));
  }

  async head(key: string) {
    try {
      const stat = await fsPromises.stat(this.path(key));
      return { size: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    await fsPromises.rm(this.path(key), { force: true });
  }

  async createReadStream(key: string, range?: string) {
    const path = this.path(key);
    const stat = await fsPromises.stat(path);
    const parsed = parseByteRange(range, stat.size);
    return parsed
      ? {
          stream: createReadStream(path, {
            start: parsed.start,
            end: parsed.end,
          }),
          size: parsed.end - parsed.start + 1,
          statusCode: 206 as const,
          contentRange: `bytes ${parsed.start}-${parsed.end}/${stat.size}`,
        }
      : {
          stream: createReadStream(path),
          size: stat.size,
          statusCode: 200 as const,
        };
  }

  async signPut() {
    return null;
  }

  async signGet() {
    return null;
  }

  private path(key: string) {
    return isAbsolute(key) ? key : join(this.root, key);
  }
}

class S3ResourceStorage implements ResourceStorage {
  readonly provider = "s3" as const;
  private readonly bucket = requiredEnv("RESOURCE_S3_BUCKET");
  private readonly client = new S3Client({
    region: process.env.RESOURCE_S3_REGION ?? "us-east-1",
    ...(process.env.RESOURCE_S3_ENDPOINT
      ? { endpoint: process.env.RESOURCE_S3_ENDPOINT }
      : {}),
    forcePathStyle: process.env.RESOURCE_S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requiredEnv("RESOURCE_S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("RESOURCE_S3_SECRET_ACCESS_KEY"),
    },
  });

  async put(key: string, data: Uint8Array, mimeType: string) {
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
        CacheControl: "private, max-age=31536000, immutable",
      }),
    );
    return { size: data.byteLength, etag: stripEtag(response.ETag) };
  }

  async get(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Object ${key} returned no body.`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async head(key: string) {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: response.ContentLength ?? 0,
        etag: stripEtag(response.ETag),
        mimeType: response.ContentType,
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async createReadStream(key: string, range?: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }),
    );
    if (!response.Body) throw new Error(`Object ${key} returned no body.`);
    return {
      stream: response.Body as Readable,
      size: response.ContentLength ?? 0,
      statusCode: response.ContentRange ? (206 as const) : (200 as const),
      ...(response.ContentRange ? { contentRange: response.ContentRange } : {}),
      ...(response.ETag ? { etag: stripEtag(response.ETag) } : {}),
    };
  }

  signPut(key: string, mimeType: string, expiresInSeconds: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  signGet(key: string, expiresInSeconds: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

function parseByteRange(value: string | undefined, size: number) {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return null;
  const start = rawStart
    ? Number(rawStart)
    : Math.max(0, size - Number(rawEnd));
  const end =
    rawEnd && rawStart ? Math.min(Number(rawEnd), size - 1) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    return null;
  return { start, end };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for S3 resource storage.`);
  return value;
}

function stripEtag(value?: string) {
  return value?.replace(/^"|"$/g, "");
}
