# 媒体权限

Web 与桌面端录音由前端的 `getUserMedia` 方法请求运行时授权。macOS 的
`NSMicrophoneUsageDescription` 已在根目录 `Info.plist` 中声明。

Android/iOS 原生工程生成后，运行下面的命令补齐平台声明：

```sh
pnpm --filter @echoo/client sync:media-permissions
```

该命令会为 Android 添加 `android.permission.RECORD_AUDIO`，并为 iOS 添加
`NSMicrophoneUsageDescription`。每次重新生成移动工程后可以安全地再次执行。
