# Media storage and cache operations

Echoo keeps durable metadata in MySQL, media bodies in local or S3-compatible
storage, short-lived coordination in Redis, and recent offline media in the
client cache. Redis never stores media bytes.

## Development

`docker compose up -d` starts MySQL, Redis, and a private MinIO bucket. Local
filesystem storage remains the default. To exercise the object-storage path,
set:

```env
RESOURCE_STORAGE_PROVIDER=s3
RESOURCE_S3_ENDPOINT=http://127.0.0.1:9000
RESOURCE_S3_REGION=us-east-1
RESOURCE_S3_BUCKET=echoo-private
RESOURCE_S3_ACCESS_KEY_ID=echoo
RESOURCE_S3_SECRET_ACCESS_KEY=echoo-local-secret
RESOURCE_S3_FORCE_PATH_STYLE=true
```

Production object storage must allow CORS for the deployed Web/Tauri origins
because uploads and cached image responses are transferred directly with
short-lived signed URLs. The bucket itself stays private.

After enabling S3, migrate existing local resources in resumable batches with
`pnpm --filter @echoo/server migrate:resources`. The command copies and hashes
the original, creates image variants, then switches the MySQL row to S3. It
keeps the old local file for rollback; remove legacy files only after checking
the migrated object counts and hashes.

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
message or agent reference for at least 24 hours. Legacy local files are
excluded from automatic deletion until they have been explicitly migrated.

## Delivery

`POST /api/resources/access` verifies ownership and returns ten-minute access
URLs keyed by resource and variant. Object storage serves these URLs directly.
The local compatibility endpoint supports `Range`, `206`, `Content-Range`, and
`Accept-Ranges` and is protected by the same short-lived media token.

Images normally request `thumb` or `display`; `original` is reserved for an
explicit full-image action. Audio uses a direct signed URL so the browser can
issue byte-range requests. The client stores recent response bodies in Cache
Storage and only LRU metadata in IndexedDB.
