如果需要进行测试，需要将测试临时目录显式指向 /tmp ，否则tsx 会试图在 Windows 临时目录创建 IPC 管道而导致失败

且为了防止触发pnpm的交互式依赖检查，需要携带CI=true

借助codegraph mcp快速辅助理解代码

由于项目还在开发阶段，一般情况不用考虑旧数据库兼容
一般情况不用使用浏览器级的验证

Android 构建约定：
- 首次构建前运行 `CI=true pnpm --filter @echoo/client tauri android init --ci`；构建使用 `CI=true pnpm --filter @echoo/client tauri android build --apk --target aarch64 --ci`。
- 发布签名使用 `apps/client/src-tauri/echoo-release.keystore` 及本地忽略的 `apps/client/src-tauri/.android-signing.env` 中的 `TAURI_ANDROID_KEYSTORE_*` 配置；Tauri 输出的 `*-unsigned.apk` 必须再用 Android SDK 的 `apksigner` 签名并验证 v2/v3。
- Windows 上 Cargo 缓存与项目不在同一盘符时，保留 `apps/client/src-tauri/gen/android/gradle.properties` 中的 `kotlin.incremental=false`，否则 Kotlin 增量编译会因路径根冲突失败。
- 移动端入口须保留 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`；Android 插件模块需依赖 `project(":tauri-android")`，并让 Kotlin 与 Java 的 JVM target 一致。
