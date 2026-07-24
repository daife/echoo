import { primeWorldExportBundleSchema } from "@echoo/shared";
import type {
  CreatePrimeWorldRequest,
  JsonValue,
  PrimeWorldExportBundle,
} from "@echoo/shared";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { compilePrimeWorld } from "./prime-world-compiler.js";

export async function materializePrimeWorldBundle(
  ownerUserId: string,
  input: unknown,
  resources = new ResourceRepository(),
) {
  const bundle = primeWorldExportBundleSchema.parse(
    input,
  ) as PrimeWorldExportBundle;
  const saved: Awaited<
    ReturnType<ResourceRepository["savePrimeWorldBundleResource"]>
  >[] = [];
  const cleanup = async () => {
    await Promise.allSettled(saved.map((resource) =>
      resources.deleteOwnedByPublicPath(ownerUserId, resource.publicPath),
    ));
  };
  try {
    const map = new Map<string, string>();
    for (const resource of bundle.resources) {
      if (map.has(resource.key)) throw new Error(`DUPLICATE_BUNDLE_RESOURCE:${resource.key}`);
      const value = await resources.savePrimeWorldBundleResource(
        ownerUserId,
        resource.mimeType,
        resource.fileName,
        Buffer.from(resource.dataBase64, "base64"),
      );
      saved.push(value);
      map.set(resource.key, value.id);
    }
    const detail = structuredClone(bundle.detail);
    detail.definitionRevision = 1;
    rewritePrimeWorldResourceIds(detail as unknown as JsonValue, (id) => {
      if (!id.startsWith("bundle:")) return id;
      const mapped = map.get(id.slice(7));
      if (!mapped) throw new Error(`BUNDLE_RESOURCE_MISSING:${id}`);
      return mapped;
    });
    compilePrimeWorld(detail);
    const request: CreatePrimeWorldRequest = {
      type: "prime-world",
      name: bundle.name,
      attributes: bundle.attributes,
      tags: bundle.tags,
      introduction: bundle.introduction,
      isPublic: bundle.isPublic,
      detail,
    };
    return { request, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function rewritePrimeWorldResourceIds(
  value: JsonValue,
  rewrite: (id: string) => string,
) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => rewritePrimeWorldResourceIds(item, rewrite));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "resourceId" && typeof child === "string") value[key] = rewrite(child);
    else rewritePrimeWorldResourceIds(child, rewrite);
  }
}
