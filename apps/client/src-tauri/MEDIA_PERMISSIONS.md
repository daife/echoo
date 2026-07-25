# 媒体权限

Web 与桌面端录音由前端的 `getUserMedia` 方法请求运行时授权。macOS 的
`NSMicrophoneUsageDescription` 已在根目录 `Info.plist` 中声明。

通过客户端的 `tauri` 脚本执行移动端初始化或构建时，会自动补齐平台声明：

```sh
CI=true pnpm --filter @echoo/client tauri android build --apk --target aarch64 --ci
```

该流程会为 Android 添加 `android.permission.RECORD_AUDIO` 与
`android.permission.MODIFY_AUDIO_SETTINGS`（Tauri/Wry 的 WebView 音频捕获会同时检查
两者），并为 iOS 添加 `NSMicrophoneUsageDescription`。脚本可重复执行；如需单独同步，仍可运行
`pnpm --filter @echoo/client sync:media-permissions`。
