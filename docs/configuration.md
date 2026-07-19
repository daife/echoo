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

## 手机局域网 HTTPS 调试

手机浏览器只允许可信安全上下文申请麦克风权限。通过 `http://192.168.x.x:5173` 访问时，文字和媒体浏览可以工作，但录音会被浏览器禁止。开发环境应为电脑的局域网 IP 签发本地可信证书：

1. 安装 `mkcert`，运行 `mkcert -install`，创建 `certs` 目录，再运行 `mkcert -cert-file certs/echoo-lan.pem -key-file certs/echoo-lan-key.pem 192.168.1.100 localhost 127.0.0.1`（将 IP 替换为电脑当前局域网地址）。
2. 将生成的证书和私钥放在未提交的目录，例如仓库根目录 `certs/`；把 `mkcert -CAROOT` 中的根证书安装到测试手机并设为受信任证书。
3. 创建不会提交的 `.env.secure.local`：

   ```dotenv
   VITE_API_BASE_URL=/api
   VITE_WS_URL=/ws
   ECHOO_DEV_HTTPS_CERT=certs/echoo-lan.pem
   ECHOO_DEV_HTTPS_KEY=certs/echoo-lan-key.pem
   ```

4. 先启动服务端，再运行 `pnpm --filter @echoo/client dev:secure`，最后在手机访问 `https://192.168.1.100:5173`。

安全模式把同源 `/api` 和 `/ws` 分别代理到本机 `8787` 端口，避免 HTTPS 页面访问 HTTP/WS 服务时被 mixed-content 策略拦截。普通 `pnpm dev` 和 Tauri 仍使用 `.env` 中原有的绝对地址。

## 管理后台

- `billing_multiplier` 是上游实际美元成本的统一倍率；一次角色运行首次使用付费平台能力时读取并固定该倍率。
- 模型目录和推荐项供用户配置页选择，不进入消息生成热路径。
- `new_user_runtime_defaults` 保存完整但无密钥的运行模板。所有端点强制使用平台来源，注册时复制快照，既有用户不随模板变更。

## Fish Audio 计费

Fish Audio 按输入文本的 UTF-8 字节数计费。明确列入免费白名单的模型成本为 0；其他及未知模型按 15 USD / 1,000,000 UTF-8 字节估算。中文通常每个汉字占 3 个 UTF-8 字节。
