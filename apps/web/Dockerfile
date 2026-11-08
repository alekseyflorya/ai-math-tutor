# Build context: repository root.  docker build -f apps/web/Dockerfile .
# The image is Caddy itself: it serves the static app, proxies /api to the API
# container and obtains/renews the HTTPS certificate automatically.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@tutor/web..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @tutor/shared build && pnpm --filter @tutor/web build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/sites /etc/caddy/sites
COPY --from=build /repo/apps/web/dist /srv
