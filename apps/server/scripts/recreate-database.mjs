import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import { createClient } from "redis";

const environmentPath = resolve(import.meta.dirname, "../../../.env");
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

if (process.env.ECHOO_CONFIRM_RECREATE !== "echoo") {
  console.error(
    "Refusing to recreate storage. Set ECHOO_CONFIRM_RECREATE=echoo to confirm permanent deletion.",
  );
  process.exit(2);
}

const mysqlUrl = new URL(
  process.env.MYSQL_URL ?? "mysql://echoo:echoo@127.0.0.1:3306/echoo",
);
const database = decodeURIComponent(mysqlUrl.pathname.replace(/^\//, ""));
if (!/^[A-Za-z0-9_]+$/.test(database) || ["mysql", "sys", "information_schema", "performance_schema"].includes(database))
  throw new Error(`Unsafe MySQL database name: ${database}`);

const connection = await mysql.createConnection({
  host: mysqlUrl.hostname,
  port: Number(mysqlUrl.port || 3306),
  user: decodeURIComponent(mysqlUrl.username),
  password: decodeURIComponent(mysqlUrl.password),
  multipleStatements: true,
});
try {
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await connection.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.changeUser({ database });
  const schema = await readFile(
    resolve(import.meta.dirname, "../src/infra/database/schema.sql"),
    "utf8",
  );
  await connection.query(schema);
} finally {
  await connection.end();
}

const redis = createClient({
  url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
});
redis.on("error", (error) => console.error("Redis error:", error));
await redis.connect();
try {
  for await (const keys of redis.scanIterator({ MATCH: "echoo:*", COUNT: 500 })) {
    if (keys.length) await redis.unlink(keys);
  }
} finally {
  await redis.quit();
}

console.log(`Recreated MySQL database ${database} and cleared Redis keys matching echoo:*.`);
