import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResourceStorage } from "./resource-storage.js";

test("local resource storage streams byte ranges without reading the full file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "echoo-resource-storage-"));
  const previous = process.env.RESOURCE_STORAGE_DIR;
  process.env.RESOURCE_STORAGE_DIR = directory;
  try {
    const storage = createResourceStorage("local");
    await storage.put(
      "user/resource.bin",
      Buffer.from("0123456789"),
      "application/octet-stream",
    );
    const opened = await storage.createReadStream(
      "user/resource.bin",
      "bytes=2-5",
    );
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));

    assert.equal(opened.statusCode, 206);
    assert.equal(opened.contentRange, "bytes 2-5/10");
    assert.equal(opened.size, 4);
    assert.equal(Buffer.concat(chunks).toString(), "2345");
  } finally {
    if (previous === undefined) delete process.env.RESOURCE_STORAGE_DIR;
    else process.env.RESOURCE_STORAGE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
