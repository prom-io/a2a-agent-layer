# syntax=docker/dockerfile:1

# Production image for the PROM Agent Layer. Build from the repository root:
#
#   docker build -f docker/Dockerfile -t a2a-agent-layer .
#
# Pin the base image by digest in the registry build if byte-for-byte
# reproducibility is required; the tag below tracks Node 20 security patches.
ARG NODE_IMAGE=node:20-alpine

# ---------- deps: production node_modules only ----------
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

# ---------- builder: full deps, compiled output ----------
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build && test -f dist/main.js

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime

# tini reaps zombies and forwards SIGTERM, which node as PID 1 does not do.
# Without it the shutdown hooks never fire: the metering rollup timer is not
# cleared and buffered trace spans are not flushed.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

# Production dependencies come from `deps`, never from `builder`: shipping the
# build toolchain roughly triples the image and widens the CVE surface with
# code that never runs in production.
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
COPY --from=builder --chown=node:node /app/package.json ./
# Contract addresses per network, read at runtime by the address registry.
COPY --chown=node:node deployments ./deployments

# npm and corepack are not needed at runtime: the service is started with node
# directly. Removing them also removes the packages bundled inside npm, which
# are a recurring source of image-scan findings unrelated to this service.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# The unprivileged user that ships with the official image (uid 1000).
USER node

EXPOSE 3001

# /health is public, exempt from rate limiting and includes a database ping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3001,path:'/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
