# Build from the repository root so the independently versioned server and web
# projects retain their own lockfiles and toolchains.
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/index.html web/tsconfig.json web/vite.config.ts ./
COPY web/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production
ENV WEB_DIST_PATH=/app/web
RUN apk add --no-cache ffmpeg
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY server/drizzle ./drizzle
COPY server/package.json ./
COPY --from=web-build /app/web/dist /app/web
EXPOSE 8080
CMD ["node", "dist/index.js"]
