import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadEnvironment();

const [{ buildApp }, { getServerConfig }] = await Promise.all([
  import("./app.js"),
  import("./infra/config/server-config.js"),
]);

const config = getServerConfig();
const app = await buildApp();

await app.listen({ host: config.host, port: config.port });
app.log.info(`Echoo server listening on ${config.host}:${config.port}`);

function loadEnvironment() {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  );
  if (existsSync(path)) process.loadEnvFile(path);
}
