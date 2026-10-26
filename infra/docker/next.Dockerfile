# syntax=docker/dockerfile:1.7
# Forest storefront / admin (Next.js standalone). APP=web|admin
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /repo

FROM base AS build
ARG APP
# Baked into next.config (image remotePatterns) at build time.
ARG S3_PUBLIC_URL=https://cdn.forest.uz/forest-public
ENV S3_PUBLIC_URL=${S3_PUBLIC_URL}
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec turbo run build --filter=@forest/${APP}...

FROM node:22-alpine AS runtime
ARG APP
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
COPY --from=build --chown=app:app /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=app:app /repo/apps/${APP}/public ./apps/${APP}/public
ENV APP_DIR=apps/${APP}
USER app
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node $APP_DIR/server.js"]
