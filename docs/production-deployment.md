# Echoo 生产部署（Ubuntu + Nginx + systemd + R2）

本指南部署到 `www.echooo.uk`：Nginx 提供 Web 客户端和 TLS，systemd 运行 Echoo API/WebSocket，Docker Compose 只运行 MySQL 与 Redis，媒体对象存入私有 Cloudflare R2 Bucket `echooo`。

## 架构

```text
浏览器
  └─ https://www.echooo.uk
       ├─ /       → Nginx 静态文件（/var/www/echooo）
       ├─ /api/*  → 127.0.0.1:8787（Echoo API）
       └─ /ws     → 127.0.0.1:8787（Echoo WebSocket）

Echoo API
  ├─ 127.0.0.1:3306（Docker MySQL）
  ├─ 127.0.0.1:6379（Docker Redis）
  └─ Cloudflare R2（私有 Bucket；浏览器通过预签名 URL 直传、直下）
```

公网防火墙只开放 `80`、`443` 和管理所需的 SSH 端口。不要开放 `8787`、`3306`、`6379`。

## 1. 安装运行环境与获取代码

以下命令以 `root` 用户、仓库位于 `/root/echoo` 为例。

```bash
apt update
apt install -y nginx certbot python3-certbot-nginx rsync
corepack enable
corepack prepare pnpm@11.7.0 --activate

git clone <仓库地址> /root/echoo
cd /root/echoo
CI=true pnpm install --frozen-lockfile
```

另行安装 Docker Engine 与 Docker Compose plugin。确认版本：

```bash
docker compose version
pnpm --version
node --version
```

## 2. 创建生产 `.env`

`.env` 含密钥，已被 Git 忽略；应通过安全渠道复制到服务器，而不是提交到仓库：

```bash
chmod 600 /root/echoo/.env
```

生产环境的关键配置如下。`NODE_ENV` **不要**写入 `.env`：Vite 也会读取该文件，并不支持在 `.env` 内声明 `NODE_ENV=production`。它由后面的 systemd 服务单独设置。

```env
VITE_API_BASE_URL=https://www.echooo.uk/api
VITE_WS_URL=wss://www.echooo.uk/ws

SERVER_HOST=127.0.0.1
SERVER_PORT=8787
CLIENT_URL=https://www.echooo.uk
OPENROUTER_SITE_URL=https://www.echooo.uk
PUBLIC_SERVER_URL=https://www.echooo.uk
JWT_SECRET=<至少 32 字节的随机值>

MYSQL_DATABASE=echoo
MYSQL_USER=echoo
MYSQL_PASSWORD=<随机值>
MYSQL_ROOT_PASSWORD=<另一个随机值>
MYSQL_URL=mysql://echoo:<MYSQL_PASSWORD>@127.0.0.1:3306/echoo

REDIS_PASSWORD=<随机值>
REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379

RESOURCE_STORAGE_PROVIDER=s3
RESOURCE_S3_ENDPOINT=https://e3d306e6a32c6d09aa10d3488312adf8.r2.cloudflarestorage.com
RESOURCE_S3_REGION=auto
RESOURCE_S3_BUCKET=echooo
RESOURCE_S3_ACCESS_KEY_ID=<R2 Access Key ID>
RESOURCE_S3_SECRET_ACCESS_KEY=<R2 Secret Access Key>
RESOURCE_S3_FORCE_PATH_STYLE=true
RESOURCE_S3_DIRECT_UPLOADS=true
RESOURCE_S3_DIRECT_DOWNLOADS=true
```

`MYSQL_URL` 和 `REDIS_URL` 中的密码必须与对应的 `MYSQL_PASSWORD`、`REDIS_PASSWORD` 完全一致。Cloudflare R2 的普通 API Token 不用于 S3 访问；只填写 R2 API Token 创建页面给出的 S3 Access Key ID 和 Secret Access Key。

## 3. 启动 MySQL 和 Redis

```bash
cd /root/echoo
docker compose up -d mysql redis
docker compose ps
```

首次启动会用 `.env` 中的数据库密码初始化 Docker volume。以后修改 `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD` 或 `REDIS_PASSWORD` **不会**修改已有 volume 内的账号密码。

如果是尚未写入任何数据的新部署，可重新初始化：

```bash
cd /root/echoo
docker compose down -v
docker compose up -d mysql redis
```

此命令会永久删除 MySQL 和 Redis 数据。已有数据时不要执行；应以旧的 MySQL root 密码登录后执行 `ALTER USER` 迁移密码。

## 4. 构建并发布 Web 静态文件

不要运行 `pnpm dev`，它仅用于开发，会启动 Vite 和带文件监听的服务端。

```bash
cd /root/echoo
CI=true pnpm build

install -d -m 755 /var/www/echooo
rsync -a --delete apps/client/dist/ /var/www/echooo/
chown -R www-data:www-data /var/www/echooo
```

Nginx 使用 `/var/www/echooo`，而不是 `/root/echoo/apps/client/dist`；默认 Nginx 用户无法穿过 `/root` 目录读取文件。

## 5. 创建 systemd 后端服务

创建 `/etc/systemd/system/echoo.service`：

```ini
[Unit]
Description=Echoo API and WebSocket server
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=/root/echoo
EnvironmentFile=/root/echoo/.env
Environment=NODE_ENV=production
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/env pnpm --filter @echoo/server start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用并查看日志：

```bash
systemctl daemon-reload
systemctl enable --now echoo
systemctl status echoo --no-pager
journalctl -u echoo -f
```

服务端只监听 `127.0.0.1:8787`。如启动失败，先检查 MySQL、Redis 容器状态和 `.env` 中两条连接 URL 的密码是否一致。

## 6. 配置 Nginx 与 HTTPS

创建 `/etc/nginx/sites-available/echooo.uk`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name echooo.uk;
    return 301 https://www.echooo.uk$request_uri;
}

server {
    listen 80;
    listen [::]:80;
    server_name www.echooo.uk;
    root /var/www/echooo;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用该站点、检查配置并申请证书：

```bash
ln -s /etc/nginx/sites-available/echooo.uk /etc/nginx/sites-enabled/echooo.uk
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
certbot --nginx -d www.echooo.uk -d echooo.uk
```

确认证书已签发后，将站点文件替换为以下最终配置：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name echooo.uk www.echooo.uk;
    return 301 https://www.echooo.uk$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name echooo.uk;

    ssl_certificate /etc/letsencrypt/live/www.echooo.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.echooo.uk/privkey.pem;
    return 301 https://www.echooo.uk$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.echooo.uk;

    ssl_certificate /etc/letsencrypt/live/www.echooo.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.echooo.uk/privkey.pem;

    root /var/www/echooo;
    index index.html;
    client_max_body_size 16m;

    location /api/ {
        proxy_pass http://127.0.0.1:8787/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8787/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

应用配置：

```bash
nginx -t && systemctl reload nginx
```

最终访问路径为：

| 地址 | 处理方 |
| --- | --- |
| `https://www.echooo.uk/` | Nginx 返回 Web 客户端 |
| `https://www.echooo.uk/api/*` | Nginx 代理至 Echoo API |
| `wss://www.echooo.uk/ws` | Nginx 代理至 Echoo WebSocket |
| `https://echooo.uk/*` | 重定向到 `https://www.echooo.uk/*` |

## 7. 配置 R2 CORS

直传和直下需要在 Cloudflare R2 Bucket `echooo` 的 **Settings → CORS Policy** 中设置精确来源：

```json
[
  {
    "AllowedOrigins": ["https://www.echooo.uk"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Bucket 保持私有。客户端仅获取有效期十分钟的预签名 URL；Echoo 服务端仍负责鉴权、创建待上传记录、完成后的对象检查和媒体处理。

## 更新与排障

发布新版本：

```bash
cd /root/echoo
git pull
CI=true pnpm install --frozen-lockfile
CI=true pnpm build
rsync -a --delete apps/client/dist/ /var/www/echooo/
systemctl restart echoo
nginx -t && systemctl reload nginx
```

常用检查命令：

```bash
systemctl status echoo --no-pager
journalctl -u echoo -n 100 --no-pager
docker compose ps
docker compose logs --tail=100 mysql redis
curl -I https://www.echooo.uk/
curl -I https://www.echooo.uk/api/health
```

如果 `docker compose up` 提示 `MYSQL_PASSWORD` 或 `REDIS_PASSWORD` 缺失，说明服务器的 `.env` 没有从安全位置复制完整。若 MySQL 报 `Access denied`，优先检查已有 Docker volume 是否是用旧密码初始化，参见第 3 节。

R2 的 S3 Access Key、Secret Access Key、Cloudflare API Token，以及 `.env` 内的数据库密码和 JWT Secret 都是生产密钥；不要提交、复制到日志或发送到聊天中。已经泄露的密钥应立即在 Cloudflare 或相应系统中轮换。
