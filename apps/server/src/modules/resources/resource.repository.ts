import { randomUUID } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { AgentResourceUpload } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";

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

interface ResourceRow {
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
  private readonly db = getDatabase();
  private readonly rootDir = resolve(
    process.cwd(),
    process.env.RESOURCE_STORAGE_DIR ?? ".data/resources",
  );

  saveImage(
    ownerUserId: string,
    kind: "agent_avatar" | "agent_cover",
    upload: AgentResourceUpload,
  ): ResourceRecord {
    const extension = allowedMimeTypes.get(upload.mimeType);
    if (!extension) throw new Error("Unsupported image type.");

    const buffer = Buffer.from(stripDataUrlPrefix(upload.dataBase64), "base64");
    if (buffer.length === 0) throw new Error("Image is empty.");
    if (buffer.length > 5 * 1024 * 1024)
      throw new Error("图片大小不能超过 5MB。");

    const id = `res_${randomUUID()}`;
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

    this.db
      .prepare(
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
      )
      .run(
        id,
        ownerUserId,
        kind,
        upload.mimeType,
        upload.fileName,
        storagePath,
        publicPath,
        now,
      );

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

  saveGeneratedMedia(
    ownerUserId: string,
    kind: "prime_figure_voice" | "prime_figure_image",
    mimeType: string,
    data: Buffer,
  ): ResourceRecord {
    const extension = generatedMimeTypes.get(mimeType);
    if (!extension)
      throw new Error(`Unsupported generated media type: ${mimeType}.`);
    if (!data.length) throw new Error("Generated media is empty.");

    const id = `res_${randomUUID()}`;
    const fileName = `${id}${extension}`;
    const storagePath = join(this.rootDir, ownerUserId, fileName);
    const publicPath = `/api/resources/${id}/file`;
    const now = Date.now();
    mkdirSync(dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, data);
    this.db
      .prepare(
        `INSERT INTO resources (
          id, owner_user_id, kind, mime_type, original_file_name,
          storage_path, public_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        ownerUserId,
        kind,
        mimeType,
        fileName,
        storagePath,
        publicPath,
        now,
      );
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

  findById(id: string): ResourceRecord | null {
    const row = this.db
      .prepare("SELECT * FROM resources WHERE id = ?")
      .get(id) as unknown as ResourceRow | undefined;
    return row ? rowToResource(row) : null;
  }

  findByPublicPath(ownerUserId: string, publicPath: string) {
    const row = this.db
      .prepare(
        "SELECT * FROM resources WHERE owner_user_id = ? AND public_path = ?",
      )
      .get(ownerUserId, publicPath) as ResourceRow | undefined;
    return row ? rowToResource(row) : null;
  }

  readForOwner(ownerUserId: string, id: string) {
    const record = this.findById(id);
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
