import { environment } from "./environment.js";

export function getServerConfig() {
  return {
    host: environment.serverHost,
    port: environment.serverPort,
  };
}
