import { createHash } from "node:crypto";
import { extname } from "node:path";
import {
  estimateMp3DurationSeconds,
  type AgentResourceUpload,
  type MessageMediaUpload,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, queryRows } from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";
import {
  createResourceStorage,
  type ResourceStorage,
} from "./resource-storage.js";

const allowedMimeTypes = new Map([["image/jpeg", ".jpg"]]);

const generatedMimeTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/ogg", ".ogg"],
]);

const userMediaMimeTypes = new Map([
  ...allowedMimeTypes,
  ["audio/mpeg", ".mp3"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"],
  ["video/mov", ".mov"],
  ["video/mpeg", ".mpeg"],
]);

export interface ResourceRecord {
  id: string;
  ownerUserId: string;
  kind: string;
  mimeType: string;
  originalFileName: string;
  storageProvider: "local" | "s3";
  storageKey: string;
  publicPath: string;
  byteSize?: number;
  sha256?: string;
  status: "pending" | "processing" | "ready" | "failed" | "deleting";
  durationSeconds?: number;
  createdAt: number;
}

export class InvalidMediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMediaUploadError";
  }
}

interface ResourceRow extends RowDataPacket {
  id: string;
  owner_user_id: string;
  kind: string;
  mime_type: string;
  original_file_name: string;
  storage_provider: "local" | "s3";
  storage_key: string;
  public_path: string;
  byte_size: number | null;
  sha256: string | null;
  duration_ms: number | null;
  status: ResourceRecord["status"];
  created_at: number;
}

export interface ResourceVariantRecord {
  resourceId: string;
  variant: "original" | "thumb" | "display";
  storageProvider: "local" | "s3";
  storageKey: string;
  mimeType: string;
  byteSize: number;
  etag?: string;
}

interface ResourceVariantRow extends RowDataPacket {
  resource_id: string;
  variant: ResourceVariantRecord["variant"];
  storage_provider: ResourceVariantRecord["storageProvider"];
  storage_key: string;
  mime_type: string;
  byte_size: number;
  etag: string | null;
}

export class ResourceRepository {
  constructor(
    private readonly storage: ResourceStorage = createResourceStorage(),
  ) {}

  async saveImage(
    ownerUserId: string,
    kind:
      | "agent_avatar"
      | "agent_cover"
      | "prime_figure_reference"
      | "prime_figure_sticker",
    upload: AgentResourceUpload,
  ): Promise<ResourceRecord> {
    const extension = allowedMimeTypes.get(upload.mimeType);
    if (!extension)
      throw new InvalidMediaUploadError("图片必须压缩为 JPEG 格式。");

    const buffer = Buffer.from(stripDataUrlPrefix(upload.dataBase64), "base64");
    validateJpegUpload(buffer);

    return this.persistReadyResource({
      ownerUserId,
      kind,
      mimeType: upload.mimeType,
      fileName: upload.fileName,
      extension,
      data: buffer,
    });
  }

  async saveGeneratedMedia(
    ownerUserId: string,
    kind: "prime_figure_voice" | "prime_figure_image",
    mimeType: string,
    data: Buffer,
  ): Promise<ResourceRecord> {
    const extension = generatedMimeTypes.get(mimeType);
    if (!extension)
      throw new Error(`Unsupported generated media type: ${mimeType}.`);
    if (!data.length) throw new Error("Generated media is empty.");

    return this.persistReadyResource({
      ownerUserId,
      kind,
      mimeType,
      fileName: `generated${extension}`,
      extension,
      data,
    });
  }

  async saveUserMedia(
    ownerUserId: string,
    kind: "end_user_image" | "end_user_voice" | "end_user_video",
    upload: MessageMediaUpload,
  ): Promise<ResourceRecord> {
    const extension = userMediaMimeTypes.get(upload.mimeType);
    const expectedKind = userMediaKind(upload.mimeType);
    if (!extension || expectedKind !== kind)
      throw new InvalidMediaUploadError("不支持的媒体格式。");

    const data = Buffer.from(stripDataUrlPrefix(upload.dataBase64), "base64");
    const durationSeconds = validateUserMediaData(kind, data, upload.mimeType);

    return this.persistReadyResource({
      ownerUserId,
      kind,
      mimeType: upload.mimeType,
      fileName: upload.fileName,
      extension,
      data,
      durationSeconds,
    });
  }

  async createPendingUpload(input: {
    ownerUserId: string;
    kind: "end_user_image" | "end_user_voice" | "end_user_video";
    fileName: string;
    mimeType: string;
    byteSize: number;
  }) {
    const extension = userMediaMimeTypes.get(input.mimeType);
    const expectedKind = userMediaKind(input.mimeType);
    if (!extension || expectedKind !== input.kind)
      throw new InvalidMediaUploadError("不支持的媒体格式。");
    const maximum =
      input.kind === "end_user_image" ? 5 * 1024 * 1024 : 12 * 1024 * 1024;
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize <= 0 ||
      input.byteSize > maximum
    )
      throw new InvalidMediaUploadError("媒体文件大小无效。");

    const id = createId("res");
    const storageKey = `${input.ownerUserId}/${id}/original${extension}`;
    const now = Date.now();
    await execute(
      `INSERT INTO resources (
        id, owner_user_id, kind, mime_type, original_file_name,
        storage_provider, storage_key, public_path,
        byte_size, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        input.ownerUserId,
        input.kind,
        input.mimeType,
        input.fileName,
        this.storage.provider,
        storageKey,
        `/api/resources/${id}/file`,
        input.byteSize,
        now,
        now,
      ],
    );
    return {
      resource: await this.findById(id),
      uploadUrl: await this.storage.signPut(
        storageKey,
        input.mimeType,
        10 * 60,
      ),
      uploadMethod: "PUT" as const,
    };
  }

  async putPendingUploadForOwner(
    ownerUserId: string,
    id: string,
    data: Buffer,
  ) {
    const record = await this.findById(id);
    if (
      !record ||
      record.ownerUserId !== ownerUserId ||
      record.status !== "pending"
    )
      return null;
    this.assertStorageProvider(record.storageProvider);
    if (this.storage.provider !== "local")
      throw new InvalidMediaUploadError("该资源必须直接上传到对象存储。");
    if (record.byteSize !== undefined && data.length !== record.byteSize)
      throw new InvalidMediaUploadError("上传内容大小与声明不一致。");
    await this.storage.put(record.storageKey, data, record.mimeType);
    return record;
  }

  async markPendingUploadProcessing(ownerUserId: string, id: string) {
    const record = await this.findById(id);
    if (!record || record.ownerUserId !== ownerUserId) return null;
    if (record.status === "ready" || record.status === "processing")
      return record;
    if (record.status !== "pending") return null;
    this.assertStorageProvider(record.storageProvider);
    const object = await this.storage.head(record.storageKey);
    if (!object || !object.size)
      throw new InvalidMediaUploadError("上传对象不存在或为空。");
    if (record.byteSize !== undefined && object.size !== record.byteSize)
      throw new InvalidMediaUploadError("上传内容大小与声明不一致。");
    await execute(
      "UPDATE resources SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'",
      [Date.now(), id],
    );
    return this.findById(id);
  }

  async listRecoverableUploads() {
    const rows = await queryRows<ResourceRow>(
      "SELECT * FROM resources WHERE status = 'processing' ORDER BY created_at ASC LIMIT 1000",
    );
    return rows.map(rowToResource);
  }

  async processUpload(id: string) {
    const record = await this.findById(id);
    if (!record || record.status === "ready") return record;
    if (record.status !== "processing") return null;
    this.assertStorageProvider(record.storageProvider);
    try {
      const data = await this.storage.get(record.storageKey);
      const durationSeconds = validateUserMediaData(
        record.kind === "end_user_voice"
          ? "end_user_voice"
          : record.kind === "end_user_video"
            ? "end_user_video"
            : "end_user_image",
        data,
        record.mimeType,
      );
      const sha256 = digest(data);
      await this.upsertVariant(record, "original", {
        mimeType: record.mimeType,
        data,
      });
      if (record.kind === "end_user_image") {
        const sharp = (await import("sharp")).default;
        const image = sharp(data, { failOn: "error" }).rotate();
        const thumb = await image
          .clone()
          .resize({
            width: 256,
            height: 256,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 78 })
          .toBuffer();
        const display = await image
          .clone()
          .resize({
            width: 1280,
            height: 1280,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 84 })
          .toBuffer();
        await this.upsertVariant(record, "thumb", {
          mimeType: "image/webp",
          data: thumb,
        });
        await this.upsertVariant(record, "display", {
          mimeType: "image/webp",
          data: display,
        });
      }
      await execute(
        `UPDATE resources SET byte_size = ?, sha256 = ?, duration_ms = ?,
          status = 'ready', updated_at = ? WHERE id = ?`,
        [
          data.length,
          sha256,
          durationSeconds === undefined
            ? null
            : Math.round(durationSeconds * 1000),
          Date.now(),
          id,
        ],
      );
      return this.findById(id);
    } catch (error) {
      throw error;
    }
  }

  async markProcessingFailed(id: string) {
    await execute(
      "UPDATE resources SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'processing'",
      [Date.now(), id],
    );
  }

  async listOrphanedResources(cutoff: number, limit = 100) {
    const rows = await queryRows<ResourceRow>(
      `SELECT resources.* FROM resources
       LEFT JOIN message_resources ON message_resources.resource_id = resources.id
       LEFT JOIN agent_resources ON agent_resources.resource_id = resources.id
       WHERE resources.status IN ('ready', 'failed', 'pending')
         AND resources.created_at < ?
         AND (resources.status != 'ready' OR resources.storage_key LIKE '%/original.%')
         AND message_resources.resource_id IS NULL
         AND agent_resources.resource_id IS NULL
       ORDER BY resources.created_at ASC LIMIT ?`,
      [cutoff, limit],
    );
    return rows.map(rowToResource);
  }

  async deleteOrphanedResource(id: string) {
    const record = await this.findById(id);
    if (!record) return false;
    const variants = await this.listVariants(id);
    this.assertStorageProvider(record.storageProvider);
    for (const variant of variants)
      this.assertStorageProvider(variant.storageProvider);
    const result = await execute(
      `UPDATE resources SET status = 'deleting', updated_at = ?
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM message_resources WHERE resource_id = resources.id
       ) AND NOT EXISTS (
         SELECT 1 FROM agent_resources WHERE resource_id = resources.id
       )`,
      [Date.now(), id],
    );
    if (!result.affectedRows) return false;
    await Promise.allSettled(
      variants.map((variant) => this.storage.delete(variant.storageKey)),
    );
    if (!variants.some((variant) => variant.storageKey === record.storageKey))
      await this.storage.delete(record.storageKey);
    await execute(
      "DELETE FROM resources WHERE id = ? AND status = 'deleting'",
      [id],
    );
    return true;
  }

  async listVariants(resourceId: string) {
    const rows = await queryRows<ResourceVariantRow>(
      "SELECT * FROM resource_variants WHERE resource_id = ?",
      [resourceId],
    );
    return rows.map(rowToVariant);
  }

  async findVariant(
    resourceId: string,
    variant: ResourceVariantRecord["variant"],
  ) {
    const row = await queryOne<ResourceVariantRow>(
      "SELECT * FROM resource_variants WHERE resource_id = ? AND variant = ?",
      [resourceId, variant],
    );
    return row ? rowToVariant(row) : null;
  }

  async replaceAgentReferences(
    agentId: string,
    references: Array<{ resourceId: string; usageKind: string }>,
  ) {
    await execute("DELETE FROM agent_resources WHERE agent_id = ?", [agentId]);
    for (const reference of references)
      await execute(
        `INSERT IGNORE INTO agent_resources
          (agent_id, resource_id, usage_kind, created_at) VALUES (?, ?, ?, ?)`,
        [agentId, reference.resourceId, reference.usageKind, Date.now()],
      );
  }

  async findById(id: string): Promise<ResourceRecord | null> {
    const row = await queryOne<ResourceRow>(
      "SELECT * FROM resources WHERE id = ?",
      [id],
    );
    return row ? rowToResource(row) : null;
  }

  async canUserAccess(userId: string, resourceId: string) {
    const row = await queryOne<RowDataPacket>(
      `SELECT resources.id FROM resources
       WHERE resources.id = ? AND (
         resources.owner_user_id = ? OR
         EXISTS (
           SELECT 1 FROM character_asset_version_resources version_resources
           JOIN character_asset_versions versions
             ON versions.id = version_resources.version_id
           JOIN character_assets assets ON assets.id = versions.asset_id
           LEFT JOIN character_asset_installations installations
             ON installations.version_id = versions.id
              AND installations.owner_user_id = ?
           WHERE version_resources.resource_id = resources.id
             AND (assets.status = 'published' OR installations.id IS NOT NULL)
         )
       ) LIMIT 1`,
      [resourceId, userId, userId],
    );
    return Boolean(row);
  }

  async findByPublicPath(ownerUserId: string, publicPath: string) {
    const row = await queryOne<ResourceRow>(
      "SELECT * FROM resources WHERE owner_user_id = ? AND public_path = ?",
      [ownerUserId, publicPath],
    );
    return row ? rowToResource(row) : null;
  }

  async deleteOwnedByPublicPath(ownerUserId: string, publicPath: string) {
    const record = await this.findByPublicPath(ownerUserId, publicPath);
    if (!record) return false;
    const variants = await this.listVariants(record.id);
    this.assertStorageProvider(record.storageProvider);
    for (const variant of variants)
      this.assertStorageProvider(variant.storageProvider);
    await execute("DELETE FROM resources WHERE id = ? AND owner_user_id = ?", [
      record.id,
      ownerUserId,
    ]);
    await Promise.allSettled(
      variants.map((variant) => this.storage.delete(variant.storageKey)),
    );
    if (!variants.some((variant) => variant.storageKey === record.storageKey))
      await this.storage.delete(record.storageKey);
    return true;
  }

  async readForOwner(ownerUserId: string, id: string) {
    const record = await this.findById(id);
    if (!record || record.ownerUserId !== ownerUserId) return null;
    this.assertStorageProvider(record.storageProvider);
    return {
      record,
      data: await this.storage.get(record.storageKey),
    };
  }

  async openReadStream(record: ResourceRecord, range?: string) {
    this.assertStorageProvider(record.storageProvider);
    return this.storage.createReadStream(record.storageKey, range);
  }

  async openVariantReadStream(
    record: ResourceRecord,
    variant: ResourceVariantRecord["variant"],
    range?: string,
  ) {
    const selected =
      (await this.findVariant(record.id, variant)) ??
      (variant === "original"
        ? null
        : await this.findVariant(record.id, "original"));
    this.assertStorageProvider(
      selected?.storageProvider ?? record.storageProvider,
    );
    return this.storage.createReadStream(
      selected?.storageKey ?? record.storageKey,
      range,
    );
  }

  async createAccessUrl(
    record: ResourceRecord,
    variant: ResourceVariantRecord["variant"],
    signDirectUrl = true,
  ) {
    const selected =
      (await this.findVariant(record.id, variant)) ??
      (variant === "original"
        ? null
        : await this.findVariant(record.id, "original"));
    this.assertStorageProvider(
      selected?.storageProvider ?? record.storageProvider,
    );
    const key = selected?.storageKey ?? record.storageKey;
    return {
      url: signDirectUrl ? await this.storage.signGet(key, 10 * 60) : null,
      variant: selected?.variant ?? "original",
      mimeType: selected?.mimeType ?? record.mimeType,
      byteSize: selected?.byteSize ?? record.byteSize,
      etag: selected?.etag,
      storageKey: key,
    };
  }

  private async persistReadyResource(input: {
    ownerUserId: string;
    kind: string;
    mimeType: string;
    fileName: string;
    extension: string;
    data: Buffer;
    durationSeconds?: number;
  }) {
    const id = createId("res");
    const storageKey = `${input.ownerUserId}/${id}/original${input.extension}`;
    const publicPath = `/api/resources/${id}/file`;
    const now = Date.now();
    const stored = await this.storage.put(
      storageKey,
      input.data,
      input.mimeType,
    );
    try {
      await execute(
        `INSERT INTO resources (
          id, owner_user_id, kind, mime_type, original_file_name,
          storage_provider, storage_key, public_path, byte_size,
          sha256, duration_ms, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
        [
          id,
          input.ownerUserId,
          input.kind,
          input.mimeType,
          input.fileName,
          this.storage.provider,
          storageKey,
          publicPath,
          input.data.length,
          digest(input.data),
          input.durationSeconds === undefined
            ? null
            : Math.round(input.durationSeconds * 1000),
          now,
          now,
        ],
      );
      await execute(
        `INSERT INTO resource_variants (
          resource_id, variant, storage_provider, storage_key, mime_type,
          byte_size, etag, created_at, updated_at
        ) VALUES (?, 'original', ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          this.storage.provider,
          storageKey,
          input.mimeType,
          input.data.length,
          stored.etag ?? null,
          now,
          now,
        ],
      );
      if (input.mimeType.startsWith("image/")) {
        const record = (await this.findById(id))!;
        const sharp = (await import("sharp")).default;
        const image = sharp(input.data, { failOn: "error" }).rotate();
        const thumb = await image
          .clone()
          .resize({
            width: 256,
            height: 256,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 78 })
          .toBuffer();
        const display = await image
          .clone()
          .resize({
            width: 1280,
            height: 1280,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 84 })
          .toBuffer();
        await this.upsertVariant(record, "thumb", {
          mimeType: "image/webp",
          data: thumb,
        });
        await this.upsertVariant(record, "display", {
          mimeType: "image/webp",
          data: display,
        });
      }
    } catch (error) {
      await execute("DELETE FROM resources WHERE id = ?", [id]).catch(
        () => undefined,
      );
      await this.storage.delete(storageKey).catch(() => undefined);
      await this.storage
        .delete(`${input.ownerUserId}/${id}/thumb.webp`)
        .catch(() => undefined);
      await this.storage
        .delete(`${input.ownerUserId}/${id}/display.webp`)
        .catch(() => undefined);
      throw error;
    }
    return (await this.findById(id))!;
  }

  private async upsertVariant(
    record: ResourceRecord,
    variant: ResourceVariantRecord["variant"],
    input: { mimeType: string; data: Buffer },
  ) {
    const extension =
      input.mimeType === "image/webp" ? ".webp" : extname(record.storageKey);
    const key =
      variant === "original"
        ? record.storageKey
        : `${record.ownerUserId}/${record.id}/${variant}${extension}`;
    this.assertStorageProvider(record.storageProvider);
    const stored =
      variant === "original"
        ? await this.storage.head(key)
        : await this.storage.put(key, input.data, input.mimeType);
    const now = Date.now();
    await execute(
      `INSERT INTO resource_variants (
        resource_id, variant, storage_provider, storage_key, mime_type,
        byte_size, etag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE storage_provider = VALUES(storage_provider),
        storage_key = VALUES(storage_key), mime_type = VALUES(mime_type),
        byte_size = VALUES(byte_size), etag = VALUES(etag), updated_at = VALUES(updated_at)`,
      [
        record.id,
        variant,
        record.storageProvider,
        key,
        input.mimeType,
        input.data.length,
        stored?.etag ?? null,
        now,
        now,
      ],
    );
  }

  private assertStorageProvider(provider: "local" | "s3") {
    assertStorageProviderMatches(this.storage.provider, provider);
  }
}

export function assertStorageProviderMatches(
  configured: "local" | "s3",
  recorded: "local" | "s3",
) {
  if (recorded !== configured)
    throw new Error(
      `Resource provider ${recorded} does not match configured provider ${configured}. Use a database created for the configured storage backend.`,
    );
}

export function isJpeg(data: Uint8Array) {
  return (
    data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  );
}

export function validateJpegUpload(data: Uint8Array) {
  if (!data.length) throw new InvalidMediaUploadError("图片文件不能为空。");
  if (data.length > 5 * 1024 * 1024)
    throw new InvalidMediaUploadError("图片大小不能超过 5MB。");
  if (!isJpeg(data))
    throw new InvalidMediaUploadError("图片内容不是有效的 JPEG 文件。");
}

export function validateUserMediaData(
  kind: "end_user_image" | "end_user_voice" | "end_user_video",
  data: Uint8Array,
  mimeType?: string,
) {
  if (kind === "end_user_image") {
    validateJpegUpload(data);
    return undefined;
  }
  if (!data.length) throw new InvalidMediaUploadError("媒体文件不能为空。");
  if (kind === "end_user_video") {
    if (data.length > 12 * 1024 * 1024)
      throw new InvalidMediaUploadError("视频大小不能超过 12MB。");
    if (!isLikelyVideo(data, mimeType))
      throw new InvalidMediaUploadError("视频内容与声明的格式不匹配。");
    return undefined;
  }

  const durationSeconds = estimateMp3DurationSeconds(data);
  if (durationSeconds < 0.8)
    throw new InvalidMediaUploadError(
      "语音文件不是有效的 MP3，或说话时间太短。",
    );
  // One MP3 frame of encoder padding is tolerated at the 60-second boundary.
  if (durationSeconds > 60.1)
    throw new InvalidMediaUploadError("语音时长不能超过 60 秒。");
  return durationSeconds;
}

function isLikelyVideo(data: Uint8Array, mimeType?: string) {
  if (mimeType === "video/webm")
    return (
      data.length >= 4 &&
      data[0] === 0x1a &&
      data[1] === 0x45 &&
      data[2] === 0xdf &&
      data[3] === 0xa3
    );
  if (mimeType === "video/mpeg")
    return (
      data.length >= 4 &&
      data[0] === 0x00 &&
      data[1] === 0x00 &&
      data[2] === 0x01 &&
      (data[3] === 0xba || data[3] === 0xb3)
    );
  if (
    mimeType === "video/mp4" ||
    mimeType === "video/quicktime" ||
    mimeType === "video/mov"
  )
    return (
      data.length >= 12 &&
      data[4] === 0x66 &&
      data[5] === 0x74 &&
      data[6] === 0x79 &&
      data[7] === 0x70
    );
  return false;
}

function userMediaKind(mimeType: string) {
  if (mimeType.startsWith("image/")) return "end_user_image" as const;
  if (mimeType === "audio/mpeg") return "end_user_voice" as const;
  if (mimeType.startsWith("video/") && userMediaMimeTypes.has(mimeType))
    return "end_user_video" as const;
  return null;
}

function stripDataUrlPrefix(value: string) {
  const commaIndex = value.indexOf(",");
  return value.startsWith("data:") && commaIndex >= 0
    ? value.slice(commaIndex + 1)
    : value;
}

function rowToResource(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    mimeType: row.mime_type,
    originalFileName: row.original_file_name,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    publicPath: row.public_path,
    ...(row.byte_size !== null ? { byteSize: row.byte_size } : {}),
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    ...(row.duration_ms !== null
      ? { durationSeconds: row.duration_ms / 1000 }
      : {}),
    status: row.status,
    createdAt: row.created_at,
  };
}

function rowToVariant(row: ResourceVariantRow): ResourceVariantRecord {
  return {
    resourceId: row.resource_id,
    variant: row.variant,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    ...(row.etag ? { etag: row.etag } : {}),
  };
}

function digest(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}
