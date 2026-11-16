# syntax=docker/dockerfile:1
# Digital Forensics Case and Evidence Management Portal
# Multi-stage build: stage 1 builds the React client, stage 2 is a small runtime image
# that runs the Express API and serves the built client on one port.

# ---------- Stage 1: build the React client ----------
FROM node:22-alpine AS build
WORKDIR /app

# Copy only the manifests first so the dependency layer is cached between builds.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund

COPY client client
RUN npm run build

# ---------- Stage 2: production runtime ----------
FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.title="digital-forensics-portal" \
      org.opencontainers.image.description="Digital Forensics Case and Evidence Management Portal (React + Express + MongoDB)" \
      org.opencontainers.image.source="https://github.com/2303A51041/digital-forensics-portal"

ENV NODE_ENV=production \
    PORT=5000 \
    DATA_DIR=/data \
    SEED_DEMO=true
WORKDIR /app

# Install only the server's production dependencies.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force

COPY server/src server/src
COPY --from=build /app/client/dist client/dist

# Evidence uploads and the generated JWT secret live in /data (mount a volume here).
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server/src/server.js"]
