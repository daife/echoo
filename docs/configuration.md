# Echoo 配置边界

Echoo 的配置分为三层。部署配置来自仓库根目录 `.env`，管理员业务配置保存在 MySQL，用户运行配置按用户和会话保存。三层不互相复制密钥。

## 生效时点

| 层级 | 典型内容 | 生效时点 |
| --- | --- | --- |
| 前端环境变量 | `VITE_API_BASE_URL`、`VITE_WS_URL` | 重启 Vite 或重新构建客户端 |
| 服务端环境变量 | 监听、JWT、MySQL、Redis、存储、邮件、平台密钥、管理员密码 | 重启服务端 |
| 管理员设置 | 计费倍率、模型目录与推荐、新用户运行模板 | 保存后立即生效；新用户模板仅影响之后注册的用户 |
| 用户运行配置 | 模型、TTS、上下文、输出能力、唤醒与节奏 | 下一次角色运行；会话自定义配置优先于用户全局配置 |

## 根目录 `.env`

- 进程与网络：`NODE_ENV`、`SERVER_HOST`、`SERVER_PORT`、`CLIENT_URL`、`JWT_SECRET`。
- 数据与队列：`MYSQL_URL`、`MYSQL_POOL_SIZE`、`REDIS_URL`、运行并发和消息缓存参数。
- 资源存储：`RESOURCE_STORAGE_PROVIDER` 及 `RESOURCE_STORAGE_*`。选择 S3 时，Bucket 和访问凭据为必填项。
- 可选集成：Resend、OpenRouter 请求来源标识和管理员密码。缺少密钥时只禁用对应能力。
- 平台能力：仅使用 `PLATFORM_OPENROUTER_*` 和 `PLATFORM_FISH_AUDIO_*`。这些密钥只在服务端内存中解析，不写入用户配置或管理后台。

`.env.example` 是完整变量清单；本地 `.env` 可以只覆盖部署所需值。旧的 `OPENROUTER_API_KEY`、`FISH_AUDIO_API_KEY`、`DEFAULT_*` 等名称不再读取。

## 管理后台

- `billing_multiplier` 是上游实际美元成本的统一倍率；一次角色运行首次使用付费平台能力时读取并固定该倍率。
- 模型目录和推荐项供用户配置页选择，不进入消息生成热路径。
- `new_user_runtime_defaults` 保存完整但无密钥的运行模板。所有端点强制使用平台来源，注册时复制快照，既有用户不随模板变更。

## Fish Audio 计费

Fish Audio 按输入文本的 UTF-8 字节数计费。明确列入免费白名单的模型成本为 0；其他及未知模型按 15 USD / 1,000,000 UTF-8 字节估算。中文通常每个汉字占 3 个 UTF-8 字节。
