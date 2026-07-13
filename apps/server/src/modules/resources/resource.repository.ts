import {
  createReadStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { AgentResourceUpload } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne } from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";

const allowedMimeTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const generatedMimeTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/ogg", ".ogg"],
]);

export interface ResourceRecord {
  id: string;
  ownerUserId: string;
  kind: string;
  mimeType: string;
  originalFileName: string;
  storagePath: string;
  publicPath: string;
  createdAt: number;
}

interface ResourceRow extends RowDataPacket {
  id: string;
  owner_user_id: string;
  kind: string;
  mime_type: string;
  original_file_name: string;
  storage_path: string;
  public_path: string;
  created_at: number;
}

export class ResourceRepository {
  private readonly rootDir = resolve(
    process.cwd(),
    process.env.RESOURCE_STORAGE_DIR ?? ".data/resources",
  );

  async saveImage(
    ownerUserId: string,
    kind: "agent_avatar" | "agent_cover",
    upload: AgentResourceUpload,
  ): Promise<ResourceRecord> {
    const extension = allowedMimeTypes.get(upload.mimeType);
    if (!extension) throw new Error("Unsupported image type.");

    const buffer = Buffer.from(stripDataUrlPrefix(upload.dataBase64), "base64");
    if (buffer.length === 0) throw new Error("Image is empty.");
    if (buffer.length > 5 * 1024 * 1024)
      throw new Error("图片大小不能超过 5MB。");

    const id = createId("res");
    const originalExtension = extname(upload.fileName).toLowerCase();
    const finalExtension = allowedMimeTypes.has(upload.mimeType)
      ? extension
      : originalExtension;
    const storagePath = join(
      this.rootDir,
      ownerUserId,
      `${id}${finalExtension}`,
    );
    const publicPath = `/api/resources/${id}/file`;
    const now = Date.now();

    mkdirSync(dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, buffer);

    await execute(
        `
          INSERT INTO resources (
            id,
            owner_user_id,
            kind,
            mime_type,
            original_file_name,
            storage_path,
            public_path,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      [
        id,
        ownerUserId,
        kind,
        upload.mimeType,
        upload.fileName,
        storagePath,
        publicPath,
        now,
      ]);

    return {
      id,
      ownerUserId,
      kind,
      mimeType: upload.mimeType,
      originalFileName: upload.fileName,
      storagePath,
      publicPath,
      createdAt: now,
    };
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

    const id = createId("res");
    const fileName = `${id}${extension}`;
    const storagePath = join(this.rootDir, ownerUserId, fileName);
    const publicPath = `/api/resources/${id}/file`;
    const now = Date.now();
    mkdirSync(dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, data);
    await execute(
        `INSERT INTO resources (
          id, owner_user_id, kind, mime_type, original_file_name,
          storage_path, public_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        id,
        ownerUserId,
        kind,
        mimeType,
        fileName,
        storagePath,
        publicPath,
        now,
      ]);
    return {
      id,
      ownerUserId,
      kind,
      mimeType,
      originalFileName: fileName,
      storagePath,
      publicPath,
      createdAt: now,
    };
  }

  async findById(id: string): Promise<ResourceRecord | null> {
    const row = await queryOne<ResourceRow>("SELECT * FROM resources WHERE id = ?", [id]);
    return row ? rowToResource(row) : null;
  }

  async findByPublicPath(ownerUserId: string, publicPath: string) {
    const row = await queryOne<ResourceRow>(
        "SELECT * FROM resources WHERE owner_user_id = ? AND public_path = ?",
      [ownerUserId, publicPath]);
    return row ? rowToResource(row) : null;
  }

  async deleteOwnedByPublicPath(ownerUserId: string, publicPath: string) {
    const record = await this.findByPublicPath(ownerUserId, publicPath);
    if (!record) return false;
    await execute(
      "DELETE FROM resources WHERE id = ? AND owner_user_id = ?",
      [record.id, ownerUserId],
    );
    rmSync(record.storagePath, { force: true });
    return true;
  }

  async readForOwner(ownerUserId: string, id: string) {
    const record = await this.findById(id);
    if (!record || record.ownerUserId !== ownerUserId) return null;
    return {
      record,
      data: readFileSync(record.storagePath),
    };
  }

  createReadStream(record: ResourceRecord) {
    return createReadStream(record.storagePath);
  }
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
    storagePath: row.storage_path,
    publicPath: row.public_path,
    createdAt: row.created_at,
  };
}
