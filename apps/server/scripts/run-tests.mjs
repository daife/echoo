import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.ts")
      ? [relative(process.cwd(), path)]
      : [];
  });
}

const files = testFiles(join(process.cwd(), "src"));
if (!files.length) {
  console.error("No source test files were found.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const result = spawnSync(process.execPath, [tsxCli, "--test", ...files], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
