# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
# husky's "prepare" script wires git hooks; there's no .git in a build context.
ENV HUSKY=0
# Global npm install, not corepack: corepack's cache is keyed to the user that
# ran `prepare`, and the runner stage drops to a non-root user before CMD, which
# left corepack re-downloading pnpm over the network on every container start.
# Pinned to the pnpm major the project is developed with — pnpm 9's stricter
# workspace validation rejects this repo's pnpm-workspace.yaml (no `packages`
# field; it only carries `allowBuilds`).
RUN npm install -g pnpm@12

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# `prisma generate` only reads prisma.config.ts, it never connects — but Prisma 7
# still validates that DATABASE_URL resolves, so a build-time placeholder is enough.
# The real value comes from Railway's runtime env, not from the image.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm db:generate
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S laicos && adduser -S laicos -G laicos

# Full node_modules (not a --prod install) so the prisma CLI is present for
# `migrate deploy` at container start, not just the runtime @prisma/client.
COPY --from=builder --chown=laicos:laicos /app/node_modules ./node_modules
COPY --from=builder --chown=laicos:laicos /app/package.json ./package.json
COPY --from=builder --chown=laicos:laicos /app/dist ./dist
COPY --from=builder --chown=laicos:laicos /app/generated ./generated
COPY --from=builder --chown=laicos:laicos /app/prisma ./prisma
COPY --from=builder --chown=laicos:laicos /app/prisma.config.ts ./prisma.config.ts

USER laicos
EXPOSE 8080

# Calls the prisma binary directly, not `pnpm exec`: pnpm reconciles
# node_modules against the workspace on every exec, which fails here since
# there's no pnpm installed in this stage and no writable store to reconcile.
# migrate deploy takes its own advisory lock, so concurrent instance starts are safe.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/src/main"]
