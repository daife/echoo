import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path) process.loadEnvFile(path);
}
