# Standalone catalog worker image. Bundles this catalog's providers; joins the distributed catalog
# over Redis. No browser binaries baked — JS-heavy providers reach the shared playwright-vnc over
# CDP via REMOTE_BROWSER_CDP_URL. Multi-arch (amd64+arm64) via buildx in CI.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# REDIS_URL is the only required env; point it at the shared BullMQ Redis (same DB index the
# central scraper's JOBS_REDIS_URL uses). CATALOG_VERSION is set by Helm to the image tag.
CMD ["node", "lib/index.js"]
