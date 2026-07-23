# Echoo 配置边界

Echoo 的配置分为三层。部署配置来自仓库根目录 `.env`，管理员业务配置保存在 MySQL，用户运行配置按用户和会话保存。三层不互相复制密钥。

## 生效时点

| 层级           | 典型内容                                                        | 生效时点                                         |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 前端环境变量   | `VITE_API_BASE_URL`、`VITE_WS_URL`                              | 重启 Vite 或重新构建客户端                       |
| 服务端环境变量 | 监听、JWT、MySQL、Redis、存储、邮件、平台密钥、管理员密码       | 重启服务端                                       |
| 管理员设置     | 计费倍率、模型目录与推荐、新用户运行模板                        | 保存后立即生效；新用户模板仅影响之后注册的用户   |
| 用户运行配置   | 模型、TTS、上下文、输出能力、语音请求方式、回复分段、唤醒与节奏 | 下一次角色运行；会话自定义配置优先于用户全局配置 |

“回复自动分段”属于切片角色运行配置，只改变客户端气泡展示；“流式语音请求”属于本初角色语音输出配置。两者都支持用户全局值与会话独立覆盖，不保存在角色定义中。

## 根目录 `.env`

- 进程与网络：`NODE_ENV`、`SERVER_HOST`、`SERVER_PORT`、`CLIENT_URL`、`JWT_SECRET`。
- 数据与队列：`MYSQL_URL`、`MYSQL_POOL_SIZE`、`REDIS_URL`、运行并发和消息缓存参数。
- 资源存储：`RESOURCE_STORAGE_PROVIDER` 及 `RESOURCE_STORAGE_*`。选择 S3 时，Bucket 和访问凭据为必填项。仅当对象存储地址能被所有客户端访问且已配置 CORS 时，才开启 `RESOURCE_S3_DIRECT_UPLOADS` 或 `RESOURCE_S3_DIRECT_DOWNLOADS`；局域网开发建议均保持 `false`，通过 Echoo API 代理媒体流量。
- 可选集成：Resend、OpenRouter 请求来源标识和管理员密码。缺少密钥时只禁用对应能力。
- 平台能力：仅使用 `PLATFORM_OPENROUTER_*` 和 `PLATFORM_FISH_AUDIO_*`。这些密钥只在服务端内存中解析，不写入用户配置或管理后台。

`.env.example` 是完整变量清单；本地 `.env` 可以只覆盖部署所需值。旧的 `OPENROUTER_API_KEY`、`FISH_AUDIO_API_KEY`、`DEFAULT_*` 等名称不再读取。

## Redis 内存保护

根目录 `docker-compose.yml` 将 Redis 的 `maxmemory` 设置为 768 MB，并保留 `noeviction` 策略，避免任务队列、锁或缓存键被静默淘汰。Redis 容器另设 1 GB 硬上限，为连接、内存碎片和 AOF 操作预留空间。达到 Redis 上限后，新增写入会明确失败；应结合监控告警处理，而不是依赖数据淘汰。

任务 Stream 在消费确认后删除对应条目，同时为积压队列和失败队列设置近似长度上限。调整 Redis 上限时，进程 `maxmemory` 应继续低于容器内存限制。

## 手机局域网调试

将 `.env` 中的 `VITE_API_BASE_URL`、`VITE_WS_URL`、`CLIENT_URL` 和 `OPENROUTER_SITE_URL` 里的示例地址替换为电脑当前的局域网 IP。先启动服务端，再运行 `pnpm --filter @echoo/client dev`，最后在手机访问 `http://<电脑局域网 IP>:5173`。

Vite 开发服务同时保留 `/api` 和 `/ws` 到本机 `8787` 端口的同源代理；需要时可以在本地 `.env` 中将前端地址分别写为 `/api` 和 `/ws`。WebSocket 会根据当前页面协议自动使用 `ws:` 或 `wss:`。

局域网 HTTP 页面可以正常使用文字聊天、图片和其他不需要安全上下文的功能，但手机浏览器会禁止它申请麦克风权限。这是浏览器平台限制，不能由开发模式绕过；录音需要可信 HTTPS、localhost 或原生客户端。

## 管理后台

- `billing_multiplier` 是上游实际美元成本的统一倍率；一次角色运行首次使用付费平台能力时读取并固定该倍率。
- 模型目录和推荐项供用户配置页选择，不进入消息生成热路径。
- `new_user_runtime_defaults` 保存完整但无密钥的运行模板。所有端点强制使用平台来源，注册时复制快照，既有用户不随模板变更。

## Fish Audio 计费

Fish Audio 按输入文本的 UTF-8 字节数计费。明确列入免费白名单的模型成本为 0；其他及未知模型按 15 USD / 1,000,000 UTF-8 字节估算。中文通常每个汉字占 3 个 UTF-8 字节。
