export function getServerConfig() {
  return {
    host: process.env.SERVER_HOST ?? "127.0.0.1",
    port: Number(process.env.SERVER_PORT ?? 8787)
  };
}
