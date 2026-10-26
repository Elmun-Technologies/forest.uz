# syntax=docker/dockerfile:1.7
# Forest API (NestJS). Build: docker build -f infra/docker/api.Dockerfile .
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

FROM node:22-alpine AS runtime
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
