如果需要进行测试，需要将测试临时目录显式指向 /tmp ，否则tsx 会试图在 Windows 临时目录创建 IPC 管道而导致失败

且为了防止触发pnpm的交互式依赖检查，需要携带CI=true

Windows 测试内存约定：
- 避免通过 `pnpm --filter @echoo/server test -- <file>` 定向运行服务端测试；当前 runner 会忽略文件过滤并并发启动全仓 `tsx/esbuild`，可能耗尽内存。
- 服务端定向测试使用 `CI=true TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @echoo/server exec tsx --test --test-concurrency=1 <test-file>`。
- 客户端定向 Vitest 使用 `CI=true TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @echoo/client exec vitest run <test-files> --pool=threads --maxWorkers=1`；全量测试也应限制 worker 或顺序执行，避免与构建、类型检查并发运行。

借助codegraph mcp快速辅助理解代码

项目已经发布；涉及数据库 schema、持久化数据结构或资源引用的改动必须考虑旧数据库兼容，提供安全、幂等的迁移或回填方案，不得默认要求用户重建数据库。确需破坏性迁移时，必须明确说明影响、备份与恢复步骤。
一般情况不用使用浏览器级的验证

Shared 包约定：`packages/shared` 需要持续重构；后续涉及 shared 的改动应优先按领域拆分类型、协议、schema 与 fixtures，避免继续扩大单文件和根出口耦合。

Android 构建约定：
- 首次构建前运行 `CI=true pnpm --filter @echoo/client tauri android init --ci`；构建使用 `CI=true pnpm --filter @echoo/client tauri android build --apk --target aarch64 --ci`。
- 发布签名使用 `apps/client/src-tauri/echoo-release.keystore` 及本地忽略的 `apps/client/src-tauri/.android-signing.env` 中的 `TAURI_ANDROID_KEYSTORE_*` 配置；Tauri 输出的 `*-unsigned.apk` 必须再用 Android SDK 的 `apksigner` 签名并验证 v2/v3。
- Android 发布 APK 命名为 `echoo_<version>_android_arm64-v8a.apk`（例如 `echoo_0.1.3_android_arm64-v8a.apk`）；`apksigner` 生成的同名 `.idsig` 是辅助文件，不作为发布包。
- Windows 上 Cargo 缓存与项目不在同一盘符时，保留 `apps/client/src-tauri/gen/android/gradle.properties` 中的 `kotlin.incremental=false`，否则 Kotlin 增量编译会因路径根冲突失败。
- 移动端入口须保留 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`；Android 插件模块需依赖 `project(":tauri-android")`，并让 Kotlin 与 Java 的 JVM target 一致。
- 图标必须使用 `CI=true pnpm --filter @echoo/client tauri icon src-tauri/app-icon.json` 生成，不得直接以 `app-icon.png` 作为 Android 自适应前景。`app-icon-android-foreground.png` 需在透明方形画布中将完整图形居中缩放到约 66% 安全区，`app-icon-android-background.png` 提供 Android 专用背景；当前 Tauri 2.11.4 的 `android_fg_scale` 不作用于自适应 `ic_launcher_foreground`，不能依赖该参数避免启动器裁切。
- 图标生成后必须检查 `mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi` 的普通、圆形、前景和背景资源；普通与圆形图标应分别为 48/72/96/144/192px，前景与背景应分别为 108/162/216/324/432px。当前 Tauri 生成器会错误地产生 49px 的 hdpi 普通/圆形图标，构建前需修正为 72px，并确认自适应前景四周仍有透明安全边距。

Windows 构建约定：
- x64 正式构建使用 `CI=true TMPDIR=/tmp TEMP=/tmp TMP=/tmp pnpm --filter @echoo/client tauri build --target x86_64-pc-windows-msvc`，产物位于 `apps/client/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/{msi,nsis}`。构建日志中的“iOS 工程尚未生成”在仅构建 Windows 时属于无害提示。
- Windows x64 发布产物沿用 Tauri 命名：MSI 为 `Echoo_<version>_x64_en-US.msi`，NSIS 为 `Echoo_<version>_x64-setup.exe`（例如 `Echoo_0.1.3_x64_en-US.msi` 与 `Echoo_0.1.3_x64-setup.exe`）。
- `apps/client/src-tauri/src/main.rs` 必须保留仅对 Windows release 生效的 `windows_subsystem = "windows"` 属性；构建后应确认主程序 PE Subsystem 为 `Windows GUI (2)`，避免安装后启动时出现额外终端窗口。debug 构建继续保留控制台便于排错。
- Tauri 默认生成的 Windows EXE、MSI 与 NSIS 安装包可能未带 Authenticode 签名。对外发布前必须使用受信任的正式代码签名证书和 SHA-256 时间戳签署并验证主程序与最终安装包；不得使用本机 `WDKTestCert` 等测试证书冒充发布签名，也不得将 Tauri updater 私钥误认为 Windows Authenticode 证书。
- Tauri 构建可能刷新 `apps/client/src-tauri/gen/schemas/desktop-schema.json` 与 `windows-schema.json`。若本次确实修改了插件、命令或权限定义，应一并审查并提交生成结果；若只是普通构建且没有相关源码变化，不得盲目提交生成噪音。
