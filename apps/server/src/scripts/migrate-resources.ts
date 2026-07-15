import { closeDatabase, initializeDatabase } from "../infra/database/mysql.js";
import { ResourceRepository } from "../modules/resources/resource.repository.js";

if (process.env.RESOURCE_STORAGE_PROVIDER !== "s3")
  throw new Error(
    "Set RESOURCE_STORAGE_PROVIDER=s3 before migrating resources.",
  );

await initializeDatabase();
const resources = new ResourceRepository();
let migrated = 0;
try {
  while (true) {
    const batch = await resources.listLegacyLocalResources(50);
    if (!batch.length) break;
    for (const resource of batch) {
      await resources.migrateLegacyResource(resource);
      migrated += 1;
      console.info(`Migrated resource ${resource.id} (${migrated}).`);
    }
  }
  console.info(`Resource migration complete: ${migrated} migrated.`);
} finally {
  await closeDatabase();
}
