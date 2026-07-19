import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDevelopmentHttps } from "./vite.config";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe("Vite development HTTPS", () => {
  it("stays disabled when no certificate is configured", () => {
    expect(loadDevelopmentHttps({})).toBeUndefined();
  });

  it("requires the certificate and private key together", () => {
    expect(() =>
      loadDevelopmentHttps({ ECHOO_DEV_HTTPS_CERT: "/tmp/cert.pem" }),
    ).toThrow("同时配置");
  });

  it("loads configured certificate material", () => {
    const directory = mkdtempSync(join(tmpdir(), "echoo-vite-https-"));
    temporaryDirectories.push(directory);
    const certificatePath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    writeFileSync(certificatePath, "certificate");
    writeFileSync(keyPath, "private-key");

    const https = loadDevelopmentHttps({
      ECHOO_DEV_HTTPS_CERT: certificatePath,
      ECHOO_DEV_HTTPS_KEY: keyPath,
    });

    expect(https?.cert.toString()).toBe("certificate");
    expect(https?.key.toString()).toBe("private-key");
  });
});
