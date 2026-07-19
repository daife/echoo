import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  const https = loadDevelopmentHttps(env);
  return {
    envDir: repositoryRoot,
    plugins: [react(), tailwindcss()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: false,
      https,
      proxy: {
        "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
        "/ws": { target: "ws://127.0.0.1:8787", ws: true },
      },
    },
    preview: {
      host: "0.0.0.0",
      https,
    },
    clearScreen: false,
  };
});

export function loadDevelopmentHttps(env: Record<string, string>) {
  const certificatePath = env.ECHOO_DEV_HTTPS_CERT?.trim();
  const keyPath = env.ECHOO_DEV_HTTPS_KEY?.trim();
  if (!certificatePath && !keyPath) return undefined;
  if (!certificatePath || !keyPath)
    throw new Error(
      "启用开发 HTTPS 时必须同时配置 ECHOO_DEV_HTTPS_CERT 和 ECHOO_DEV_HTTPS_KEY。",
    );
  return {
    cert: readFileSync(resolve(repositoryRoot, certificatePath)),
    key: readFileSync(resolve(repositoryRoot, keyPath)),
  };
}
