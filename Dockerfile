# syntax=docker/dockerfile:1
# All-in-one Orvo server: web app, beacon API and signaling node in one container.
FROM node:24-slim AS build
# pnpm's own install script fetches its native binary; npm asks that scripts are allowed by name.
RUN npm install -g --allow-scripts=pnpm pnpm@12
WORKDIR /repo
# Fetch dependencies from the lockfile alone, so the layer is reused until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter @orvo/app --filter @orvo/server build
# A production-only copy of the server and the workspace packages it uses, without the dev tooling.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter @orvo/server --prod deploy /out

FROM node:24-slim
WORKDIR /srv
COPY --from=build /out /srv
COPY --from=build /repo/apps/app/dist /srv/web
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/srv/web
# Create the data directory owned by the unprivileged user before declaring the volume: a fresh named volume
# copies this ownership, so the server can write its signing key. (A bind mount keeps the host's ownership.)
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
