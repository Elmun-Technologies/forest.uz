# syntax=docker/dockerfile:1.7
# Forest API (NestJS). Build: docker build -f infra/docker/api.Dockerfile --target runtime .
# Targets: runtime (compose/production), migrate (compose one-off), demo (Fly demo: runtime + migrate/seed tools).
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@forest/api...
# Self-contained production node_modules for the api only (Prisma client + engines ship inside @forest/db).
RUN pnpm deploy --filter=@forest/api --prod --legacy /prod/api

# One-off migration runner (needs the Prisma CLI, so it reuses the build stage).
FROM build AS migrate
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# Fly demo only: @forest/db with its dev deps (Prisma CLI for the release_command, tsx + argon2 + S3
# SDK for the seed) and the seed's photos, outside the api's production node_modules.
FROM build AS demo-tools
RUN pnpm deploy --filter=@forest/db --legacy /prod/db \
  && cp -r packages/db/src packages/db/prisma.config.ts packages/db/tsconfig.json /prod/db/

FROM node:22-alpine AS runtime-base
RUN apk add --no-cache libc6-compat openssl tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build --chown=app:app /prod/api/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./package.json
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

# Fly demo image (infra/fly/api.fly.toml): the runtime plus /app/packages/db for
# `prisma migrate deploy` (release_command) and the seed (repo-relative photos at /app/design).
FROM runtime-base AS demo
COPY --from=demo-tools --chown=app:app /prod/db ./packages/db
COPY --from=build --chown=app:app /repo/design/assets/photos ./design/assets/photos

# Default target (last stage) stays the production runtime.
FROM runtime-base AS runtime
