# syntax=docker/dockerfile:1.6
# Multi-stage build for NestJS gateway
# ============================================================================
# Using node:20-slim (Debian) instead of alpine because onnxruntime-node
# requires glibc, which is not available in Alpine Linux.

# --- Stage 1: dependencies ---
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && cp -R node_modules /tmp/prod_node_modules
RUN npm ci

# --- Stage 2: build ---
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: runtime ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# non-root user
RUN groupadd -r app && useradd -r -g app app

COPY --from=deps    /tmp/prod_node_modules ./node_modules
COPY --from=builder /app/dist               ./dist
COPY                package*.json           ./
COPY                models/                 ./models/

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/v1/health', r => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/apps/gateway/apps/gateway/src/main"]
