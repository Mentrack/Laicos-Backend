# Backend setup spec (NestJS 11 + Prisma 7 + Postgres)

Build a backend with the stack, structure, and rules below.

## 1. Stack & packages

Runtime: Node 22, **pnpm only**, TypeScript 5.7, CommonJS (`module: nodenext`,
`target: ES2023`, decorators on, `strictNullChecks: true` but `noImplicitAny: false`).

Runtime deps:
- `@nestjs/common` `@nestjs/core` `@nestjs/platform-express` `@nestjs/config` (v11)
- `@nestjs/swagger` — OpenAPI document + Swagger UI
- `@prisma/client` + `prisma` v7 + `@prisma/adapter-pg` + `pg` — driver-adapter mode
- `class-validator` + `class-transformer` — DTO validation
- `@nestjs/bullmq` + `bullmq` — background jobs over Redis
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — object storage (S3 API)
- `firebase-admin` — auth (token verification); `jose` if you mint JWTs for 3rd parties
- `nodemailer` (SMTP), `twilio` (SMS/WhatsApp), `posthog-node` (analytics)
- `dotenv`, `yaml`, `reflect-metadata`, `rxjs`

Dev deps: `@nestjs/cli` `@nestjs/testing` `jest` 30 + `ts-jest` + `supertest`,
`eslint` 9 + `typescript-eslint` + `eslint-plugin-prettier` + `prettier`,
`husky` + `lint-staged`, `cross-env`, `ts-node`, `tsconfig-paths`.

Scripts:
```
start:dev    nest start --watch            (serves :8080)
build        nest build
lint         eslint "{src,apps,libs,test}/**/*.ts" --fix
test         cross-env NODE_OPTIONS=--experimental-vm-modules jest
test:e2e     jest --config ./test/jest-e2e.json
gen:openapi  nest build && node dist/src/scripts/generate-openapi.js
gen:api      pnpm gen:openapi && pnpm --dir ../webapp run gen:api
db:seed      tsc -p tsconfig.seed.json && node dist/prisma/seed.js
```
Jest: `rootDir: src`, `testRegex: .*\.spec\.ts$`. Unit specs live in
`src/<module>/tests/*.spec.ts` — never beside their source. E2E lives in `test/`.

Husky: `pre-commit` → `pnpm exec lint-staged` (`eslint --fix` + `prettier --write`
on `*.ts`); `pre-push` → `pnpm build && pnpm test`.

## 2. Docker — local dev infrastructure only

No app Dockerfile. `docker-compose.yml` runs three services the app talks to:

```yaml
services:
  postgres:  # postgres:16-alpine, host port ${POSTGRES_PORT:-5434}:5432, named volume
  redis:     # redis:7-alpine, ${REDIS_PORT:-6380}:6379, named volume
  mailhog:   # mailhog/mailhog:v1.0.1, host SMTP :1026 + web UI :8026
volumes: [postgres_data, redis_data]
```
All ports and credentials come from `${VAR:-default}` so `.env` overrides them.
MailHog is the dev mail catcher — nothing outbound leaves the machine in dev.

## 3. Architecture

```
HTTP → Controller (thin) → Service (all logic) → Prisma
                 ↑ guards + ValidationPipe      ↓
          HttpExceptionFilter            generated/client
```

**Bootstrap (`main.ts`)** does exactly five things:
1. CORS with an **explicit origin allowlist** parsed from a comma-separated
   `FRONTEND_WEBAPP_URL` (no wildcard; bearer auth, so credentials stay off).
2. Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
3. Global `HttpExceptionFilter`.
4. Builds the OpenAPI document once and serves `/v1/docs` (Swagger UI), `/v1/docs.json`, `/v1/docs.yaml`.
5. `listen(process.env.PORT ?? 8080)`.

**One OpenAPI definition (`src/openapi.ts`).** `buildOpenApiDocument(app)` is shared
by `main.ts` and `scripts/generate-openapi.ts`, so the committed `openapi.json` can
never drift from the served one. The script creates the Nest app **without starting
it** (no port, no lifecycle hooks → no DB/Redis/Firebase needed) and writes
2-space-indented JSON with a trailing newline so diffs show real API changes.
The client repo generates its types from that file — types are defined once
(DTO → openapi.json → schema.d.ts) and never retyped by hand.

**Module layout** — feature modules under `src/`, all registered in `app.module.ts`:
```
src/
  <domain>/            # auth, admins, doctors, patients, consultations, prescriptions
    <domain>.module.ts
    <domain>.controller.ts
    <domain>.service.ts
    dto/               # request DTOs + response DTOs
    formatters/        # row → response-DTO mappers
    utils/
    tests/
  common/              # dto/, filters/, pagination.ts, prisma-errors.ts, upload-pipes.ts
  prisma/ storage/ notifications/ analytics/   # infrastructure, all @Global()
```
`ConfigModule.forRoot({ isGlobal: true, expandVariables: true })` first.
Infrastructure modules are `@Global()`; feature modules import what they need
explicitly (`PrismaModule`, `AuthModule`). When a service is shared across two
domains, provide it in the module whose controller owns the routes — don't create
a circular import.

**Database.** `PrismaService extends PrismaClient` over `new PrismaPg({ connectionString })`,
implementing `OnModuleInit`/`OnModuleDestroy` to `$connect`/`$disconnect`.
Prisma generates to **`backend/generated/`, not `node_modules`**
(`generator client { provider = "prisma-client", output = "../generated", moduleFormat = "cjs" }`);
import models/enums from `'../../generated/client'` and `'../../generated/models'`.
The datasource URL lives in `prisma.config.ts`, not the schema.
For invariants a constraint can't express (e.g. "no two overlapping bookings"),
use a Postgres advisory lock helper inside the transaction:
`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))` — released on commit/rollback.

**Auth = Firebase Admin, composed as guards.** Three-guard chain:
`FirebaseAuthGuard` (verify bearer ID token → `req.firebaseUser`) →
`RequireLocalUserGuard` (look up the local row by `firebaseUid` → `req.user`, else
403 "Complete registration first") → `RolesGuard` (reflector reads `@Roles(...)`;
empty list = any authenticated user). A composite decorator collapses the stack:
```ts
export const Auth = (...roles: Role[]) =>
  applyDecorators(ApiBearerAuth(), UseGuards(FirebaseAuthGuard, RequireLocalUserGuard, RolesGuard), Roles(...roles));
```
`@CurrentUser()` param decorator injects the local user. Email verification is a
**separate** `RequireVerifiedGuard`, applied only where it's needed — not baked into `@Auth`.

**Response envelopes — the settled contract.** Every controller handler returns
exactly `{ data, message, metaData? }`; `metaData` is omitted entirely when there's
no pagination. A helper builds the Swagger type so the envelope isn't hand-declared
per route: `enveloped(DoctorCardDto, 'DoctorResponseDto')` returns a generated class
with `message` + typed `data`, used as `@ApiOkResponse({ type: ... })`.

**Errors go through one filter.** `@Catch()` `HttpExceptionFilter` is the only place
an error becomes a body:
```ts
{ message: string, error: { code: string, statusCode: number, details?: string[] } }
```
`message` is **always a single renderable string** — `ValidationPipe`'s `string[]`
is moved to `details` and its first entry capitalised into `message`. `code` maps
status → stable slug (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNPROCESSABLE`, `TOO_MANY_REQUESTS`,
else `REQUEST_FAILED`/`INTERNAL_ERROR`). 5xx is logged with its stack and replaced
with a generic message — internal faults are never echoed. Declare the shape as
`ErrorResponseDto` in `extraModels` so it lands in the OpenAPI doc.

**Pagination is shared, not per-domain.** `PaginationQueryDto` (`page` ≥ 1 default 1,
`perPage` 1–50 default 20, `@Type(() => Number)`), `resolvePagination()` → `{ page,
perPage, skip, take }` to spread into `findMany`, and `paginateInMemory()` for lists
whose ordering is derived in code. List services return `{ data, metaData }` so the
controller passes both straight through.

**Storage** is one service over the S3 API (Supabase here): `forcePathStyle: true`,
config resolved and **validated at boot** — a missing/blank required env var throws
before any request. Two buckets: public (returns a URL to persist) and private
(persist the key, serve via short-lived presigned URLs, TTL default 900s).
`onModuleInit` HEADs each bucket and refuses to boot if one is missing (the provider
answers a PUT into a nonexistent bucket with 200 and silently discards the file);
one escape hatch env var skips it for CI. Uploads are validated by shared
`ParseFilePipe` factories with size caps (5 MB images / 10 MB documents) and
**magic-byte** mime sniffing, not the client-supplied filename.

**Notifications = queue + provider registry.** `BullModule.forRootAsync` (Redis host/port
from config) and one registered queue with `attempts: 3`, exponential backoff from
1s, `removeOnComplete: { age: 3600, count: 1000 }`, `removeOnFail: { age: 86400 }`.
A `NotificationProvider` interface (`send(payload): Promise<void>`) is implemented by
email/SMS/WhatsApp/in-app; a `NotificationProviderRegistry` maps the `NotificationType`
enum → provider so adding a channel touches one Map. The processor is **idempotent**
(returns early if the row is already `SENT`), writes `SENT`/`FAILED` + error text back
to the DB, and rethrows so BullMQ's retry sees the real failure. Email HTML lives in
composable template modules behind a templates service.

Analytics is a thin `@Global()` service wrapper — vendor SDK never imported elsewhere.

## 4. Design philosophy (the rules that shaped all of the above)

1. **The client is the source of truth.** When server behaviour disagrees with what
   the client expects, the server changes. Flag every discrepancy explicitly.
2. **Controllers are thin.** Call one service method, return the envelope. No logic.
3. **DRY outranks finishing quickly.** Grep the domain and `common/` before writing
   anything; a second copy of existing logic is a defect. Simplest thing first — no
   abstractions, generics or factories until a concrete requirement forces one. One
   job per function; pull long or deeply-nested bodies into named helpers.
4. **Types are defined once** and flow DTO → openapi.json → client. Never hand-retype
   a shape on the other side.
5. **Validate config at boot, not at request time.** A misconfigured deployment should
   fail to start.
6. **Comments record why, especially bug-shaped whys** — route declaration order,
   path-style addressing, advisory locks, silent-200 uploads. Every non-obvious line
   carries the reason it exists.
7. **Lint-clean as written.** `recommendedTypeChecked` + Prettier-as-an-ESLint-rule
   (2-space, single quotes, semicolons, trailing commas). `no-explicit-any` is off but
   the `no-unsafe-*` rules are errors — narrow untyped values at the boundary rather
   than letting `any` spread. `_`-prefix deliberate discards. Never silence a rule with
   `eslint-disable` or a cast; specs downgrade the unsafe-* rules to warnings since
   mocks trip them constantly. CI runs lint → build → test → e2e.
8. **Migrations are hand-authored and reviewed.** Generate SQL with
    `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
    write it to `prisma/migrations/<timestamp>_<name>/migration.sql`, apply with
    `migrate deploy`. Never `prisma migrate dev` — it generates *and* applies in one
    interactive step and will drop a column with no backfill.
