# Build context: repository root.  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first so the dependency layer is cached between code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# @tutor/shared sources go in before install: the root postinstall builds it.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
RUN pnpm install --frozen-lockfile --filter "@tutor/api..."
COPY apps/api apps/api
RUN pnpm --filter @tutor/shared build \
 && pnpm --filter @tutor/api build \
 && pnpm --filter @tutor/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/drizzle /out/

# Runtime: production dependencies + compiled JS + SQL migrations. No build tools, no sources.
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=320", "dist/main.js"]
