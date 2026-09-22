# Supabase storage — design

## Context

The project has no storage module yet (`src/storage/` does not exist), but
`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are already
dependencies, and [CLAUDE.md](../../../CLAUDE.md) already specifies the shape
storage must take: one S3-API service with `forcePathStyle: true`, two
buckets (public persists a URL, private persists a key and serves presigned
URLs), config validated at boot with a HEAD check per bucket, and uploads
going through shared `ParseFilePipe` factories with magic-byte sniffing.

Supabase Storage exposes an S3-compatible API, so this spec implements that
existing architecture against Supabase rather than inventing a new one. The
two buckets (public + private) already exist in the Supabase project
dashboard; this spec does not cover creating them.

`Produce.imageUrl` (`prisma/schema.prisma:88`) is the only existing schema
field that consumes storage today, and `CreateProduceDto`/`UpdateProduceDto`
currently accept it as a plain client-supplied string — there is no upload
flow yet. This spec adds one.

## Goals

- A `StorageService` that can put objects into a public or private
  Supabase bucket over the S3 API, and produce a public URL or a presigned
  URL respectively.
- Config validated at boot; the app refuses to start if a bucket is missing.
- Shared upload validation (size + magic-byte content sniffing) usable by
  any domain, not just produce.
- A real upload endpoint for produce images: `POST /produce/:id/image`.

## Non-goals

- Creating the Supabase buckets or their access policies (already done
  manually).
- Any private-bucket consumer (e.g. farm verification documents) — the
  private bucket path (`uploadPrivate` / `getPresignedUrl`) is built and
  tested, but no domain wires it up yet.
- Migrating `imageUrl` on create/update away from a plain string; create and
  update DTOs are unchanged.

## Architecture

New `src/storage/` module, registered `@Global()` in `app.module.ts` the
same way `PrismaModule` is:

- `storage.module.ts` — provides and exports `StorageService`.
- `storage.service.ts` — wraps `S3Client` from `@aws-sdk/client-s3`,
  configured with `forcePathStyle: true` and pointed at Supabase's
  S3-compatible endpoint.

Shared upload validation lives in `src/common/upload-pipes.ts` (alongside
the existing `src/common/` shared code), not inside `storage/`, so any
domain module can import it without depending on the storage module's
internals.

### Config

Validated at boot via the existing `requireConfig(config, key)` helper
(`src/common/config.ts`), following the same pattern as
`PrismaService`/`FirebaseService` — construction throws immediately if a
var is missing or blank.

```
S3_ENDPOINT           # https://<project-ref>.supabase.co/storage/v1/s3
S3_REGION             # Supabase storage region, e.g. us-east-1
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_PUBLIC_BUCKET
S3_PRIVATE_BUCKET
S3_PUBLIC_URL_BASE    # https://<project-ref>.supabase.co/storage/v1/object/public
```

`S3_PUBLIC_URL_BASE` is separate from `S3_ENDPOINT` and not derived from it:
Supabase serves S3 API calls under `/storage/v1/s3` but serves public object
reads under `/storage/v1/object/public/<bucket>/<key>` — different base
paths on the same host. Deriving one from the other with string manipulation
would be fragile, so it's its own explicit var.

All six vars are added to `.env.example` with comments, matching the style
already used there for Firebase/SMTP config.

### Boot check

`StorageService.onModuleInit()` issues a `HeadBucketCommand` against both
`S3_PUBLIC_BUCKET` and `S3_PRIVATE_BUCKET` and throws if either HEAD fails,
mirroring the existing storage rule in CLAUDE.md ("the provider silently
200s a PUT into a missing bucket").

### Service surface

```ts
uploadPublic(key: string, body: Buffer, contentType: string): Promise<string>  // -> `${S3_PUBLIC_URL_BASE}/${S3_PUBLIC_BUCKET}/${key}`
uploadPrivate(key: string, body: Buffer, contentType: string): Promise<string> // -> key (not a URL)
getPresignedUrl(key: string, ttlSeconds = 900): Promise<string>               // presigned GET against the private bucket
```

`uploadPublic`/`uploadPrivate` both do a `PutObjectCommand` against their
respective bucket; they differ only in which bucket they target and what
they return (URL vs. key), matching the "public bucket persists the URL,
private bucket persists the key" split in CLAUDE.md.

### Upload validation (`src/common/upload-pipes.ts`)

Two factories returning a configured `ParseFilePipe`:

- `imageUploadPipe()` — 5 MB max, accepts JPEG/PNG/WebP by magic bytes.
- `documentUploadPipe()` — 10 MB max, accepts PDF by magic bytes (the only
  document type currently needed; extending the allow-list is a one-line
  change when a second type is needed).

Both use a custom `FileValidator` that reads the first few bytes of the
buffer and checks them against known file signatures, rather than trusting
the client-supplied `mimetype` header — the point being that a spoofed
`Content-Type` shouldn't get past validation.

## Produce image upload endpoint

`CreateProduceDto`/`UpdateProduceDto` are unchanged — `imageUrl` stays a
plain optional string on both, set directly by the client for now. This
spec adds a dedicated route to attach or replace a produce's image after
creation:

```
POST /produce/:id/image
```

- `@Auth(Role.FARMER)`, same as `update`/`remove`.
- `@UseInterceptors(FileInterceptor('file'))` + `imageUploadPipe()` on the
  file parameter.
- Ownership is checked the same way `ProduceService.update()` already does
  it: `farm: farmOwnedBy(user)` in the `findFirst`/`update` where clause; a
  produce not owned by the caller (or not found) is a 404, matching every
  other produce mutation.
- The service method (`ProduceService.attachImage(user, id, file)`) uploads
  to the public bucket under key `produce/${id}/${uuid}.${ext}` (extension
  derived from the sniffed content type, not the client-supplied filename),
  sets `produce.imageUrl` to the returned URL, and returns the updated row.
- Controller returns the standard envelope via `ApiEnvelope(ProduceDto)`,
  message `"Produce image updated"`.
- Re-uploading replaces `imageUrl` in place; the old object in the bucket is
  not deleted (no cleanup job in scope — acceptable since Supabase storage
  cost is not a concern raised for this task).

## Error handling

- `ParseFilePipe` validation failures (too large, wrong magic bytes) become
  400s automatically via Nest's built-in behavior — no custom handling
  needed.
- Produce-not-found/not-owned reuses `NotFoundException('Produce not
  found')`, matching `update()`/`remove()`.
- S3/network failures (bucket HEAD at boot, PUT/GET at request time)
  propagate as unhandled exceptions. At boot this crashes startup (intended
  — config rule 5, "a missing or blank required env var throws on
  startup"). At request time it's caught by the existing global
  `HttpExceptionFilter` and returned as a generic logged 5xx, same as any
  other domain failure — no storage-specific exception wrapping.

## Testing

- `src/storage/tests/storage.service.spec.ts` — mocks `S3Client` with
  `aws-sdk-client-mock` (new dev dependency) to verify: `uploadPublic`
  builds the right URL and issues the right `PutObjectCommand`;
  `uploadPrivate` returns the key; `getPresignedUrl` is called with the
  default and a custom TTL; `onModuleInit` throws when a `HeadBucketCommand`
  rejects.
- `src/common/tests/upload-pipes.spec.ts` — valid PNG/JPEG/WebP/PDF magic
  bytes pass their respective pipe; a buffer with a mismatched signature
  (e.g. an executable renamed `.png`) is rejected regardless of the
  `mimetype` field on the fake `Express.Multer.File`; an oversized buffer is
  rejected.
- `src/produce/tests/produce.service.spec.ts` — add cases for
  `attachImage`: happy path sets `imageUrl` and returns the row; not-found
  when the produce doesn't exist or isn't owned by the caller.

New dev dependencies: `aws-sdk-client-mock`, `@types/multer`. Neither has an
install script, so `pnpm-workspace.yaml`'s `allowBuilds` list is unaffected.

## Open questions / follow-ups (explicitly out of scope here)

- Wiring the private bucket to an actual document type (e.g. farm
  verification docs) is future work; this spec only builds and tests the
  `uploadPrivate`/`getPresignedUrl` path in isolation.
- No cleanup of orphaned objects when an image is replaced or a produce is
  deleted.
