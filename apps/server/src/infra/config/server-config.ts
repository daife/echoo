import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

function loadEnvFile() {
  const envPath = findUp(".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile();

export function getServerConfig() {
  return {
    host: process.env.SERVER_HOST ?? "127.0.0.1",
    port: Number(process.env.SERVER_PORT ?? 8787),
  };
}

function findUp(fileName: string) {
  let directory = process.cwd();
  const root = parse(directory).root;

  while (true) {
    const candidate = resolve(directory, fileName);
    if (existsSync(candidate)) return candidate;
    if (directory === root) return candidate;
    directory = dirname(directory);
  }
}
