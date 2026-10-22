# All-in-one ChillCall server: web app, beacon API and signaling node in one container.
FROM node:24-slim AS build
RUN npm install -g pnpm@12
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @chillcall/app build

FROM node:24-slim
WORKDIR /repo
COPY --from=build /repo /repo
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/repo/apps/app/dist
VOLUME /data
EXPOSE 8080
USER node
WORKDIR /repo/apps/server
CMD ["node_modules/.bin/tsx", "src/main.ts"]
