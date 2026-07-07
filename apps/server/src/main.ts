import { buildApp } from "./app.js";
import { getServerConfig } from "./infra/config/server-config.js";

const config = getServerConfig();
const app = await buildApp();

await app.listen({ host: config.host, port: config.port });
app.log.info(`Echoo server listening on ${config.host}:${config.port}`);
