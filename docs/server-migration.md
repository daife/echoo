# Echoo 生产服务器完整迁移

本文适用于当前生产拓扑：Echoo 服务端由 systemd 运行，Nginx 提供入口，Docker Compose 仅运行 MySQL 8.0 与 Redis 6.2，媒体对象保存在 Cloudflare R2。

迁移目标是完整保留业务数据、待处理任务、密钥和部署配置，并且在切换失败时仍能回到旧服务器。推荐使用“新服务器预部署 + 短暂停写 + 逻辑备份恢复”，不要直接复制运行中的 Docker volume。

## 必须迁移的内容

| 内容                                         | 当前所在位置               | 迁移方式                                      |
| -------------------------------------------- | -------------------------- | --------------------------------------------- |
| 账号、会话、消息、角色、后台设置等业务主数据 | MySQL volume `echoo_mysql` | `mysqldump` 一致性备份并恢复                  |
| 队列、锁、缓存及其他运行状态                 | Redis volume `echoo_redis` | 停写后导出 RDB 并恢复                         |
| 图片、音频等媒体对象                         | Cloudflare R2 私有 Bucket  | 沿用原 Bucket；更换 Bucket 时单独复制全部对象 |
| 数据库密码、JWT、R2 凭据等                   | `/root/echoo/.env`         | 加密传输，权限保持为 `600`                    |
| 反向代理、TLS、服务启动配置                  | Nginx、systemd 配置目录    | 复制或在新机重新创建                          |
| 应用版本                                     | Git commit、构建产物       | 新旧服务器使用同一 commit                     |

MySQL 是业务主数据源，但 Redis 不能简单视为可丢弃缓存：其中还可能有 Stream 队列、执行租约和待处理工作。完整迁移应同时恢复 MySQL 与 Redis。R2 不在 Docker volume 中，仅迁移两个 volume 并不等于完整迁移。

## 总体顺序

1. 在旧服务器仍对外服务时准备新服务器，部署相同 commit、Docker 镜像版本和配置。
2. 做一次演练备份和恢复，确认命令、空间与耗时。
3. 正式切换时先停止旧服务器的 Echoo systemd 服务，阻止新的 MySQL/Redis 写入。
4. 生成最终 MySQL 与 Redis 备份，加密后传输并校验哈希。
5. 在新服务器的空数据库和空 Redis volume 中恢复并验证。
6. 启动新服务，先从服务器本机验证，再切换 Cloudflare DNS。
7. 旧服务器保持停止但不删除，观察至少 48～72 小时后再清理。

以下命令假定仓库路径为 `/root/echoo`，服务名为 `echoo`。全部命令均在对应服务器上以有权限管理 systemd 与 Docker 的账号执行。

## 1. 切换前准备

提前降低 DNS 记录 TTL，并记录旧服务器公网 IP。Cloudflare 代理启用时，切换的是 Cloudflare DNS 记录的源站 IP。

在旧服务器记录当前版本与容器镜像：

```bash
cd /root/echoo
git rev-parse HEAD
docker compose images
docker compose ps
docker volume ls
df -h
```

在新服务器检出相同 commit，按[生产部署文档](production-deployment.md)安装 Node.js、pnpm、Docker、Nginx，并完成构建。先不要把域名切到新服务器，也不要启动 Echoo systemd 服务。

通过安全渠道把旧服务器 `/root/echoo/.env` 复制到新服务器，再确认：

```bash
chmod 600 /root/echoo/.env
```

迁移期间保持 `MYSQL_DATABASE`、`MYSQL_USER`、数据库密码、`REDIS_PASSWORD`、`JWT_SECRET` 以及 R2 Bucket/凭据不变。JWT Secret 改变会使现有登录令牌失效；数据库或 Redis 密码与 URL 不一致会导致服务无法启动。

在新服务器创建全新的 MySQL 和 Redis volume：

```bash
cd /root/echoo
docker compose up -d mysql redis
docker compose ps
```

等待两个容器健康。不要在已经承载新业务数据的 volume 上执行本文的清空恢复步骤。

## 2. 在旧服务器生成最终备份

先创建仅 root 可读的目录：

```bash
cd /root/echoo
BACKUP_DIR="/root/echoo-migration-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$BACKUP_DIR/config/nginx-ssl"
```

### 2.1 进入维护窗口并停写

```bash
systemctl stop echoo
systemctl is-active echoo
```

第二条命令应显示 `inactive`。不要停止 MySQL 和 Redis 容器；备份命令仍需连接它们。确认没有另一套 Echoo 实例、定时脚本或运维任务继续写这两个存储。

先记录校验基线：

```bash
cd /root/echoo
docker compose exec -T mysql sh -c \
  'exec mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
    -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();"' \
  > "$BACKUP_DIR/mysql-table-count.txt"
docker compose exec -T redis sh -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli DBSIZE' \
  > "$BACKUP_DIR/redis-dbsize.txt"
```

### 2.2 备份 MySQL

```bash
cd /root/echoo
docker compose exec -T mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
    --single-transaction --quick --routines --triggers --events \
    --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4 \
    "$MYSQL_DATABASE"' \
  | gzip -9 > "$BACKUP_DIR/mysql.sql.gz"
gzip -t "$BACKUP_DIR/mysql.sql.gz"
test -s "$BACKUP_DIR/mysql.sql.gz"
```

`--single-transaction` 为 InnoDB 生成一致性快照；正式切换仍然先停写，以保证 MySQL 与 Redis 处于同一个业务时间点。命令只导出 Echoo 数据库，不覆盖新服务器 MySQL 的系统库和账号初始化信息。

### 2.3 备份 Redis

```bash
cd /root/echoo
docker compose exec -T redis sh -c \
  'rm -f /data/echoo-migration.rdb && \
   REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli --rdb /data/echoo-migration.rdb'
REDIS_CONTAINER="$(docker compose ps -q redis)"
test -n "$REDIS_CONTAINER"
docker cp "$REDIS_CONTAINER:/data/echoo-migration.rdb" "$BACKUP_DIR/redis.rdb"
docker compose exec -T redis rm -f /data/echoo-migration.rdb
test -s "$BACKUP_DIR/redis.rdb"
```

`redis-cli --rdb` 通过 Redis 协议生成一致性 RDB，不会复制半写入的 AOF 文件。因为 Echoo 已停写，快照之后不会遗漏新的队列或租约变化。

### 2.4 备份配置并加密

```bash
cd /root/echoo
install -m 600 .env "$BACKUP_DIR/config/echoo.env"
install -m 600 docker-compose.yml "$BACKUP_DIR/config/docker-compose.yml"
install -m 600 /etc/systemd/system/echoo.service "$BACKUP_DIR/config/echoo.service"
install -m 600 /etc/nginx/sites-available/echooo.uk "$BACKUP_DIR/config/nginx-echooo.uk"
install -m 600 /etc/nginx/ssl/echooo.uk.pem "$BACKUP_DIR/config/nginx-ssl/echooo.uk.pem"
install -m 600 /etc/nginx/ssl/echooo.uk.key "$BACKUP_DIR/config/nginx-ssl/echooo.uk.key"

git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt"
docker compose images > "$BACKUP_DIR/docker-images.txt"
(cd "$BACKUP_DIR" && \
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
```

配置路径如有调整，以实际路径为准。备份包含生产密钥，必须先加密再跨网络传输。以下示例使用 GnuPG 对整个目录做对称加密：

```bash
ARCHIVE="${BACKUP_DIR}.tar.gpg"
tar -C "$(dirname "$BACKUP_DIR")" -cf - "$(basename "$BACKUP_DIR")" \
  | gpg --symmetric --cipher-algo AES256 --output "$ARCHIVE"
chmod 600 "$ARCHIVE"
(cd "$(dirname "$ARCHIVE")" && \
  sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
```

使用独立安全渠道传递加密口令。将 `.tar.gpg` 与 `.sha256` 复制到新服务器后，先校验外层文件：

```bash
cd /root
sha256sum -c echoo-migration-<时间戳>.tar.gpg.sha256
gpg --decrypt /root/echoo-migration-<时间戳>.tar.gpg | tar -C /root -xf -
chmod -R go-rwx /root/echoo-migration-*
```

进入解密后的备份目录并校验内部文件：

```bash
cd /root/echoo-migration-<时间戳>
sha256sum -c SHA256SUMS
gzip -t mysql.sql.gz
```

## 3. 在新服务器恢复

以下命令中的 `RESTORE_DIR` 必须改为刚才校验通过的解密目录：

```bash
RESTORE_DIR=/root/echoo-migration-<时间戳>
test -s "$RESTORE_DIR/mysql.sql.gz"
test -s "$RESTORE_DIR/redis.rdb"
```

### 3.1 恢复 MySQL

确保新服务器的 MySQL 是刚初始化的空数据库且处于健康状态：

```bash
cd /root/echoo
docker compose up -d mysql
docker compose ps mysql
gzip -dc "$RESTORE_DIR/mysql.sql.gz" \
  | docker compose exec -T mysql sh -c \
      'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
docker compose exec -T mysql sh -c \
  'exec mysqlcheck -uroot -p"$MYSQL_ROOT_PASSWORD" --check "$MYSQL_DATABASE"'
```

恢复后核对表数量：

```bash
docker compose exec -T mysql sh -c \
  'exec mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
    -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();"'
cat "$RESTORE_DIR/mysql-table-count.txt"
```

两者应一致。还应按业务选择用户、会话、消息等关键表，分别比较旧备份时记录的行数或最新记录时间。

### 3.2 恢复 Redis

恢复 RDB 必须替换新服务器 Redis volume 中自动生成的空 AOF/RDB 文件。先精确解析 `/data` 对应的 volume 名并检查结果：

```bash
cd /root/echoo
REDIS_CONTAINER="$(docker compose ps -q redis)"
test -n "$REDIS_CONTAINER"
REDIS_VOLUME="$(docker inspect "$REDIS_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
test -n "$REDIS_VOLUME"
printf '即将恢复的 Redis volume: %s\n' "$REDIS_VOLUME"
docker volume inspect "$REDIS_VOLUME"
```

确认显示的是**新服务器上刚创建、尚未承载业务数据**的 Redis volume 后再继续。下面第一条辅助容器命令会清空该 volume；第二条会先以 RDB 启动临时 Redis，再生成当前 Compose 启动参数可直接读取的 AOF：

```bash
docker compose stop redis
docker run --rm --user 0 \
  --mount "type=volume,src=$REDIS_VOLUME,dst=/data" \
  --mount "type=bind,src=$RESTORE_DIR,dst=/backup,readonly" \
  redis:6.2-alpine sh -eu -c '
    test -s /backup/redis.rdb
    find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    cp /backup/redis.rdb /data/dump.rdb
    chown redis:redis /data/dump.rdb
  '
docker run --rm --user redis \
  --mount "type=volume,src=$REDIS_VOLUME,dst=/data" \
  redis:6.2-alpine sh -eu -c '
    redis-check-rdb /data/dump.rdb
    redis-server --daemonize yes --dir /data --dbfilename dump.rdb \
      --appendonly no --save "" --pidfile /tmp/echoo-redis-migration.pid
    redis-cli CONFIG SET appendonly yes
    attempt=0
    while [ ! -s /data/appendonly.aof ] || \
      redis-cli INFO persistence | grep -q "aof_rewrite_in_progress:1"; do
      attempt=$((attempt + 1))
      test "$attempt" -lt 120
      sleep 1
    done
    redis-cli INFO persistence | grep -q "aof_last_bgrewrite_status:ok"
    redis-cli SHUTDOWN NOSAVE
    test -s /data/appendonly.aof
  '
docker compose up -d redis
docker compose ps redis
```

当前 Compose 使用 `redis:6.2-alpine` 且启动参数包含 `--appendonly yes`。上面的临时实例先载入 RDB，再通过一次 AOF rewrite 生成 `appendonly.aof`，因此正常容器启动时会从 AOF 恢复完整数据。核对载入状态和键数量：

```bash
docker compose exec -T redis sh -c \
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO persistence && \
   REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli DBSIZE'
cat "$RESTORE_DIR/redis-dbsize.txt"
```

`loading` 应为 `0`，`rdb_last_bgsave_status` 应为 `ok`，且 `DBSIZE` 应与旧服务器停写后记录的值一致。启动 Echoo 前若数量不一致，应停止排查，不要继续切换流量。

## 4. R2 与配置处理

若继续使用原 Cloudflare R2 Bucket，只需安全复制相同的 endpoint、Bucket、Access Key ID 和 Secret Access Key；对象本身无需经过服务器搬运。确认新服务器能够访问 Bucket，并抽查数据库中已有资源对应的对象可以下载。

若要同时更换 Cloudflare 账号或 R2 Bucket：

1. 在维护窗口前把源 Bucket 全量复制到目标 Bucket，保留完全相同的对象 key、Content-Type 和元数据。
2. 停写后再做一次增量复制，但不要对源 Bucket执行删除同步。
3. 对比对象总数和总字节数，并随机抽查对象校验值与下载结果。
4. 仅在确认复制完整后，把新服务器 `.env` 的 `RESOURCE_S3_*` 改为目标 Bucket。
5. 为新 Bucket 配置生产部署文档中的 CORS，保持 Bucket 私有。
6. 在迁移验收和回滚窗口结束前保留源 Bucket。

数据库中的资源记录与 R2 对象 key 是一套数据，不能只迁移其中一边。

将 systemd、Nginx 和 TLS 配置恢复到新服务器。TLS 私钥如不希望搬运，可在 Cloudflare 重新签发 Origin Certificate。应用配置后检查：

```bash
systemctl daemon-reload
nginx -t
systemctl reload nginx
```

## 5. 启动、验收与切流

先在新服务器启动 Echoo：

```bash
systemctl enable --now echoo
systemctl status echoo --no-pager
journalctl -u echoo -n 100 --no-pager
docker compose ps
```

在切换 DNS 前，可从新服务器本机验证后端和 Nginx 源站：

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -kfsS --resolve www.echooo.uk:443:127.0.0.1 \
  https://www.echooo.uk/api/health
```

然后进行业务验收：

- 使用已有账号登录，确认旧会话、消息、角色和管理设置存在。
- 打开若干历史图片/音频，确认 R2 对象可读。
- 发送一条测试消息，确认 WebSocket、任务队列和模型执行正常。
- 上传并读取一个测试资源，确认 R2 直传、直下与 CORS 正常。
- 检查 `journalctl -u echoo`、MySQL 和 Redis 日志没有鉴权、只读或持久化错误。

验收通过后，在 Cloudflare DNS 把源站 IP 改为新服务器，保持代理开启。持续观察新旧服务器访问日志，确认请求已转移。旧服务器上的 `echoo` 服务必须保持停止，防止两个服务器同时接受写入。

## 6. 回滚原则

如果新服务器尚未接受任何业务写入，可直接把 DNS 指回旧 IP，然后在旧服务器执行：

```bash
systemctl start echoo
```

如果新服务器已经接受写入，不能直接启动旧服务器，否则会丢失新写入并形成数据分叉。此时应再次进入维护窗口，停止新服务器 Echoo，按本文反方向导出新服务器的最终 MySQL/Redis 数据并恢复到旧服务器，验证后再切回。

在 48～72 小时观察期内：

- 不要执行 `docker compose down -v`，它会永久删除 MySQL 和 Redis volume。
- 不要删除旧服务器、旧 R2 Bucket 或最终备份。
- 不要在新旧两台服务器上同时运行 Echoo 服务。
- 保留备份加密文件和校验文件，并限制访问权限。

观察期结束且确认不再回滚后，再撤销旧服务器持有的凭据、删除旧主机和临时明文备份。长期备份应继续加密保存，并定期做实际恢复演练；只有成功恢复并通过业务校验的备份才可视为有效备份。

## 迁移完成检查表

- [ ] 新旧服务器运行同一 Git commit 和兼容的 MySQL/Redis 镜像版本
- [ ] 旧服务器 Echoo 已停止，最终备份期间无其他写入者
- [ ] MySQL、Redis、`.env`、systemd、Nginx/TLS 配置均已纳入备份
- [ ] 加密归档传输前后 SHA-256 一致，内部文件校验通过
- [ ] MySQL 检查通过，表数及关键业务数据已核对
- [ ] Redis 持久化状态正常，键数量与停写基线一致
- [ ] 原 R2 可继续访问，或新 Bucket 的对象与 CORS 已完整验证
- [ ] 登录、历史数据、消息、WebSocket、媒体读写均已验收
- [ ] DNS 已切换，旧服务器应用保持停止且仍可回滚
- [ ] 观察期结束后才清理旧服务器与临时明文备份
