# syntax=docker/dockerfile:1
ARG NODE_VERSION=22.22.3
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN npm install --global npm@11.6.2
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/features/package.json packages/features/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM base AS production-dependencies
COPY --from=dependencies /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=dependencies /app/apps ./apps
COPY --from=dependencies /app/packages ./packages
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/healthcheck.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["node", "scripts/healthcheck.mjs", "api"]
CMD ["node", "dist/apps/api/src/main.js"]
