# laicos backend

NestJS 11 + Prisma 7 (driver-adapter mode, Postgres) + BullMQ/Redis + Firebase Auth.
Full design spec: [setup.md](setup.md). This file holds the rules to follow when you change code.

## Commands

**pnpm only.** Never use npm or yarn.

```
docker compose up -d        # Postgres :5434, Redis :6380, MailHog SMTP :1026 / UI :8026
cp .env.example .env        # first run
pnpm db:generate            # prisma generate -> ./generated (needs DATABASE_URL in .env)
pnpm start:dev              # :8080, docs at /v1/docs
pnpm lint | pnpm build | pnpm test | pnpm test:e2e
pnpm gen:openapi            # writes openapi.json; commit it with any API change
```

- Unit specs go in `src/<module>/tests/*.spec.ts`, never next to their source. Jest `rootDir` is `src`. E2E tests go in `test/`.
- Husky: pre-commit runs lint-staged (`eslint --fix` + `prettier --write`), and pre-push runs `pnpm build && pnpm test`. Never pass `--no-verify`.
- New dependencies with install scripts must be allowed explicitly in `pnpm-workspace.yaml` under `allowBuilds`.

## Versions are pinned. Don't bump them casually.

- `@nestjs/*` stays on **v11** (the CLI scaffolds v12, which we don't use). `typescript` stays on **~5.7**.
- CommonJS output: `module: nodenext`, `target: ES2023`, `strictNullChecks: true`, `noImplicitAny: false`.

## Architecture

`Controller (thin) -> Service (all logic) -> PrismaService (Prisma)`, with guards, a global `ValidationPipe` and a global `HttpExceptionFilter`.

- **`main.ts` does exactly five things:** CORS from the comma-separated `FRONTEND_WEBAPP_URL` allowlist (no wildcard, credentials off); `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; `HttpExceptionFilter`; the OpenAPI doc served at `/v1/docs` (Swagger UI), `/v1/docs.json` and `/v1/docs.yaml`; and `listen(PORT ?? 8080)`.
- **One OpenAPI builder.** `buildOpenApiDocument(app)` in `src/openapi.ts` is shared by `main.ts` and `src/scripts/generate-openapi.ts`. The script lives under `src/` so it compiles to `dist/src/scripts/`. The script creates the app **without** `listen`/`init`, so it needs no DB, Redis or Firebase. It writes 2-space JSON with a trailing newline.
- **Module layout:** `src/<domain>/{<domain>.module|controller|service.ts, dto/, formatters/, utils/, tests/}`. Shared code lives in `src/common/` (`dto/`, `filters/`, `pagination.ts`, `prisma-errors.ts`, `upload-pipes.ts`). Infrastructure modules (`prisma/`, `storage/`, `notifications/`, `analytics/`) are `@Global()`. `ConfigModule.forRoot({ isGlobal: true, expandVariables: true })` is registered first.
- **Avoid circular imports.** When two domains share a service, provide it in the module whose controller owns the routes.
- **Prisma:** the client is generated into `./generated/` (gitignored), not `node_modules`. Import it as `'../../generated/client'` or `'../../generated/models'`. The datasource URL lives in `prisma.config.ts`, not the schema. `PrismaService extends PrismaClient` over `new PrismaPg({ connectionString })`.
  - `prisma.config.ts` loads `.env` with plain `dotenv`, which does **not** expand `${VAR}`. Keep `DATABASE_URL` literal.
  - For invariants a constraint can't express, take `SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))` inside the transaction.
- **Auth:** `@Auth(...roles)` composes `FirebaseAuthGuard` -> `RequireLocalUserGuard` -> `RolesGuard` (plus `ApiBearerAuth`). An empty role list means any authenticated user. Use `@CurrentUser()` for the local user. `RequireVerifiedGuard` is separate: apply it only where it's needed, and never bake it into `@Auth`.
- **Response envelope:** every handler returns `{ data, message, metaData? }`. Omit `metaData` unless the response is paginated. Declare Swagger types with `enveloped(Dto, 'NameResponseDto')`, not by hand.
- **Errors:** errors become a body only through `HttpExceptionFilter`, as `{ message: string, error: { code, statusCode, details?: string[] } }`.
  - `message` is always one string. Validation arrays go to `details`, and the first entry is capitalised into `message`.
  - A 5xx is logged with its stack and returned with a generic message.
- **Pagination:** use the shared `PaginationQueryDto` (`page` ≥ 1 default 1, `perPage` 1–50 default 20), `resolvePagination()` and `paginateInMemory()`. List services return `{ data, metaData }`.
- **Storage:** one S3-API service with `forcePathStyle: true` and two buckets.
  - Public bucket: persist the URL. Private bucket: persist the key and serve presigned URLs (default TTL 900s).
  - Config is validated at boot. `onModuleInit` HEADs each bucket and refuses to boot if one is missing, because the provider silently 200s a PUT into a missing bucket.
  - Uploads go through shared `ParseFilePipe` factories: 5 MB for images, 10 MB for documents, with **magic-byte** sniffing.
- **Notifications:** one BullMQ queue (3 attempts, exponential backoff from 1s, `removeOnComplete {age:3600,count:1000}`, `removeOnFail {age:86400}`).
  - `NotificationProviderRegistry` maps `NotificationType` to a provider.
  - The processor is idempotent (it skips rows already `SENT`), writes `SENT`/`FAILED` plus the error, and rethrows.
- **Analytics:** a thin `@Global()` wrapper. Import the vendor SDK nowhere else.

## Rules

1. **The client is the source of truth.** When server behaviour disagrees with what the client expects, change the server and flag the discrepancy explicitly.
2. **Controllers are thin.** They call one service method and return the envelope. No logic.
3. **DRY over speed.** Grep the domain and `src/common/` before writing anything. A second copy of existing logic is a defect.
   - Build the simplest thing first. Add abstractions only when a concrete need forces one.
   - One job per function.
4. **Types are defined once:** DTO -> `openapi.json` -> the client's `schema.d.ts`. Never retype a shape by hand.
5. **Validate config at boot.** A missing or blank required env var throws on startup, not at request time.
6. **Comments explain why,** especially bug-shaped whys: route declaration order, path-style addressing, advisory locks, silent-200 uploads.
7. **Write lint-clean code.** `recommendedTypeChecked` + Prettier (2-space, single quotes, semicolons, trailing commas).
   - `no-explicit-any` is off, but `no-unsafe-*` are errors. Narrow untyped values at the boundary.
   - `_`-prefix deliberate discards.
   - Never use `eslint-disable` or a cast to silence a rule.
8. **Hand-author migrations. Never run `prisma migrate dev`.**
    - Generate the SQL with `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
    - Save it to `prisma/migrations/<timestamp>_<name>/migration.sql`, review it, then apply with `pnpm exec prisma migrate deploy`.
