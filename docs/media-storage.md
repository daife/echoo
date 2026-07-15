# Media storage and cache operations

Echoo keeps durable metadata in MySQL, media bodies in local or S3-compatible
storage, short-lived coordination in Redis, and recent offline media in the
client cache. Redis never stores media bytes.

## Development

`docker compose up -d` starts MySQL, Redis, and a private MinIO bucket. Local
filesystem storage remains available for isolated development databases. To
use MinIO for the current database, set:

```env
RESOURCE_STORAGE_PROVIDER=s3
RESOURCE_S3_ENDPOINT=http://127.0.0.1:9000
RESOURCE_S3_REGION=us-east-1
RESOURCE_S3_BUCKET=echoo-private
RESOURCE_S3_ACCESS_KEY_ID=echoo
RESOURCE_S3_SECRET_ACCESS_KEY=echoo-local-secret
RESOURCE_S3_FORCE_PATH_STYLE=true
```

Runtime requests use exactly one configured backend. A resource row from a
different provider is rejected with an explicit configuration error; the
server never falls back to another backend. Use a separate database when
switching between local and S3 development modes.

## Production

Use a private S3-compatible bucket and application-specific credentials with
access limited to that bucket. Keep all credentials in the deployment secret
store, not in Compose files or source control.

- `RESOURCE_S3_ENDPOINT` must be reachable by the server. It must not be
  `127.0.0.1` when MinIO runs on another host or container. Omit it for AWS S3.
- Downloads use the authenticated Echoo media endpoint by default. This keeps
  images, stickers, and ranged audio working when clients cannot reach MinIO
  directly. Set `RESOURCE_S3_DIRECT_DOWNLOADS=true` only when the configured
  endpoint is browser-reachable (normally HTTPS) and its CORS policy is set.
- Set `RESOURCE_S3_FORCE_PATH_STYLE=false` for AWS S3. MinIO and some compatible
  providers require `true`.
- Allow CORS only for the deployed Web and Tauri origins and the required
  `GET`, `HEAD`, and `PUT` methods and `Content-Type`/`Range` headers.
- Keep the bucket private, enable durable volumes or provider replication, and
  back up both MySQL metadata and objects with matching retention policies.
- Never reuse the example MinIO root credentials in production.

## Upload lifecycle

1. The authenticated client creates a pending resource.
2. It uploads the binary body using the returned signed PUT URL.
3. Completion changes the MySQL state to `processing` and enqueues a Redis
   Stream job.
4. The worker validates the file and creates `thumb` and `display` WebP
   variants before marking the resource `ready`.
5. Messages may reference only ready resources.

Processing jobs are recoverable from non-terminal MySQL rows. A separate
Redis Stream periodically removes new-format resources that have had no
message or agent reference for at least 24 hours.

## Delivery

`POST /api/resources/access` verifies ownership and returns ten-minute access
URLs keyed by resource and variant. By default the authenticated server media
endpoint proxies both local and object-storage resources and supports `Range`,
`206`, `Content-Range`, and `Accept-Ranges`. Deployments may explicitly enable
direct object-storage download URLs when every client can reach that endpoint.

Images normally request `thumb` or `display`; `original` is reserved for an
explicit full-image action. Audio uses the authenticated media URL so the
browser can issue byte-range requests through the API proxy. The client stores
recent response bodies in Cache Storage and only LRU metadata in IndexedDB.
