# syntax=docker/dockerfile:1.7

###############################################################################
# PayAlly MCP Server — multi-stage, production-optimized image for AWS ECR.
#
# Stage layout:
#   deps     -> install ALL deps (incl. dev) with a cached npm store
#   build    -> compile the server (tsc) + build the UI widgets (esbuild)
#   prod-deps-> install ONLY production deps (lean node_modules)
#   runner   -> distroless-style final image: node + prod deps + built assets
#
# The final image ships compiled JS (no tsx, no TypeScript, no source), only
# production dependencies, and runs as a non-root user.
###############################################################################

# Node 22 LTS. Must be >= 22.13.0 — @astryxdesign/cli requires it (EBADENGINE
# otherwise). 22.23.4 is the current LTS patch and a security release.
ARG NODE_VERSION=22.23.4

###############################################################################
# 1. deps — full dependency install (cached)
###############################################################################
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# npm >= 11.11.0 preserves/honors the `libc` field in package-lock.json, which
# is required to install the correct musl vs glibc native binary variant of
# optional deps like @valkey/valkey-glide on Alpine. The npm bundled with
# node 22.11.0 (10.9.0) does not, and silently skips the musl binary.
RUN npm install -g npm@^11.11.0

# Only copy manifests first so this layer caches unless deps change.
COPY package.json package-lock.json ./

# Use BuildKit cache mount for the npm store -> fast, reproducible installs.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

###############################################################################
# 2. build — compile server (tsc) and bundle UI widgets (esbuild + tailwind)
###############################################################################
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Compile TypeScript server -> ./build, then build the UI widgets -> ./web/dist
RUN npx tsc -p tsconfig.json \
    && node web/build.mjs

###############################################################################
# 3. prod-deps — production-only node_modules (smallest runtime deps)
###############################################################################
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app

# Same npm upgrade as the `deps` stage: required so the musl-libc native
# binary of @valkey/valkey-glide gets installed into the lean runtime deps.
RUN npm install -g npm@^11.11.0

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
    && npm cache clean --force

###############################################################################
# 4. runner — final lean runtime image
###############################################################################
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    # Keep V8 memory modest for a lightweight container; tune via task def.
    NODE_OPTIONS=--max-old-space-size=256

# dumb-init gives us proper PID 1 signal handling (clean SIGTERM on ECS stop).
RUN apk add --no-cache dumb-init

# Production dependencies only.
COPY --from=prod-deps /app/node_modules ./node_modules

# Compiled server + built widget bundles + package manifest.
COPY --from=build /app/build ./build
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/package.json ./package.json

# Run as the built-in, unprivileged `node` user.
USER node

EXPOSE 3001

# Container healthcheck -> drives ECS "Health status" in the console.
# Hits the unauthenticated GET /health route; exits 0 only on HTTP 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('node:http').get({host:'127.0.0.1',port:process.env.PORT||3001,path:'/health',timeout:2000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "build/index.js"]
