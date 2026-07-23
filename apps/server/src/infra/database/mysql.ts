import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { environment } from "../config/environment.js";

let pool: Pool | null = null;

export function getDatabase() {
  if (pool) return pool;
  const url = new URL(environment.mysqlUrl);
  pool = mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: environment.mysqlPoolSize,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    namedPlaceholders: false,
    decimalNumbers: true,
  });
  return pool;
}

export async function initializeDatabase() {
  const schemaPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "schema.sql",
  );
  const schema = await readFile(schemaPath, "utf8");
  const connection = await getDatabase().getConnection();
  try {
    for (const statement of schema.split(/;\s*(?:\r?\n|$)/)) {
      if (statement.trim()) await connection.query(statement);
    }
    const [agentOriginColumns] = await connection.query<RowDataPacket[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'agents'
         AND column_name = 'source_public_asset_id'`,
    );
    if (!agentOriginColumns.length)
      await connection.query(
        "ALTER TABLE agents ADD COLUMN source_public_asset_id VARCHAR(64) NULL AFTER definition",
      );
    const [worldCompactionColumns] = await connection.query<RowDataPacket[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'prime_world_runs'
         AND column_name = 'compacted_at'`,
    );
    if (!worldCompactionColumns.length)
      await connection.query(
        "ALTER TABLE prime_world_runs ADD COLUMN compacted_at BIGINT NULL AFTER error_detail",
      );
    const [historyRunColumn] = await connection.query<
      Array<RowDataPacket & { is_nullable: "YES" | "NO" }>
    >(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'prime_world_history_entries'
         AND column_name = 'run_id'`,
    );
    if (historyRunColumn[0]?.is_nullable === "NO") {
      await connection.query(
        "ALTER TABLE prime_world_history_entries DROP FOREIGN KEY fk_prime_world_history_run",
      );
      await connection.query(
        "ALTER TABLE prime_world_history_entries MODIFY run_id VARCHAR(64) NULL",
      );
      await connection.query(
        `ALTER TABLE prime_world_history_entries
         ADD CONSTRAINT fk_prime_world_history_run
         FOREIGN KEY (run_id) REFERENCES prime_world_runs(id) ON DELETE SET NULL`,
      );
    }
    const [billingKindColumns] = await connection.query<RowDataPacket[]>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'billing_ledger'
         AND column_name = 'kind'`,
    );
    if (billingKindColumns[0]?.data_type === "enum")
      await connection.query(
        "ALTER TABLE billing_ledger MODIFY kind VARCHAR(48) NOT NULL",
      );
    const [characterSearchColumns] = await connection.query<RowDataPacket[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'public_asset_versions'
         AND column_name = 'search_text'`,
    );
    if (!characterSearchColumns.length)
      throw new Error(
        "检测到不兼容的旧 Echoo 公共资产搜索 schema。请确认备份后运行 ECHOO_CONFIRM_RECREATE=echoo pnpm db:recreate。",
      );
    const [legacyColumns] = await connection.query<RowDataPacket[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'conversations'
         AND column_name IN ('runtime_state', 'next_run_at')`,
    );
    if (legacyColumns.length)
      throw new Error(
        "检测到不兼容的旧 Echoo schema。请确认备份后运行 ECHOO_CONFIRM_RECREATE=echoo pnpm db:recreate。",
      );
  } finally {
    connection.release();
  }
}

export async function withTransaction<T>(
  callback: (connection: PoolConnection) => Promise<T>,
) {
  const connection = await getDatabase().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function queryRows<T extends RowDataPacket>(
  sql: string,
  values: unknown[] = [],
  connection: Pool | PoolConnection = getDatabase(),
) {
  const [rows] = await connection.query<T[]>(sql, values);
  return rows;
}

export async function queryOne<T extends RowDataPacket>(
  sql: string,
  values: unknown[] = [],
  connection: Pool | PoolConnection = getDatabase(),
) {
  const rows = await queryRows<T>(sql, values, connection);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  values: unknown[] = [],
  connection: Pool | PoolConnection = getDatabase(),
) {
  const [result] = await connection.execute<ResultSetHeader>(
    sql,
    values as never[],
  );
  return result;
}

export async function closeDatabase() {
  await pool?.end();
  pool = null;
}
