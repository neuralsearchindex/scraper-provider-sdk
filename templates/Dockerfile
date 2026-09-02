# Standalone provider worker image (deterministic tier: no browser, no LLM).
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# REDIS_URL is the only required env; point it at the shared BullMQ Redis.
CMD ["node", "lib/index.js"]
