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
