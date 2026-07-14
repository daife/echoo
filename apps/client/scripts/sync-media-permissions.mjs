import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = join(clientRoot, "src-tauri");
const androidManifest = join(
  tauriRoot,
  "gen",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
);
const microphonePermission =
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />';

if (existsSync(androidManifest)) {
  const source = readFileSync(androidManifest, "utf8");
  if (!source.includes("android.permission.RECORD_AUDIO")) {
    const next = source.replace(
      /(<application\b)/,
      `  ${microphonePermission}\n\n  $1`,
    );
    if (next === source)
      throw new Error("无法定位 AndroidManifest.xml 的 <application> 节点。");
    writeFileSync(androidManifest, next);
    console.log(`已更新 ${relative(clientRoot, androidManifest)}`);
  }
} else {
  console.log(
    "Android 工程尚未生成；完成 `pnpm tauri android init` 后再次运行即可。",
  );
}

const appleRoot = join(tauriRoot, "gen", "apple");
const microphonePlistEntry = `  <key>NSMicrophoneUsageDescription</key>
  <string>用于在聊天中录制并发送语音消息。</string>`;

if (existsSync(appleRoot)) {
  for (const plistPath of findNamedFiles(appleRoot, "Info.plist")) {
    const source = readFileSync(plistPath, "utf8");
    if (source.includes("NSMicrophoneUsageDescription")) continue;
    const next = source.replace("</dict>", `${microphonePlistEntry}\n</dict>`);
    if (next === source)
      throw new Error(
        `无法定位 ${relative(clientRoot, plistPath)} 的 </dict> 节点。`,
      );
    writeFileSync(plistPath, next);
    console.log(`已更新 ${relative(clientRoot, plistPath)}`);
  }
} else {
  console.log("iOS 工程尚未生成；完成 `pnpm tauri ios init` 后再次运行即可。");
}

function findNamedFiles(root, fileName) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...findNamedFiles(path, fileName));
    else if (entry.name === fileName) result.push(path);
  }
  return result;
}
