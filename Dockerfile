# syntax=docker/dockerfile:1
# Influensia platform — production image (Next.js `next start` + migration/bootstrap scripts).
# Built on the server itself (docker compose build). Works on arm64 (AWS t4g) and amd64.
# Dev dependencies stay in the image on purpose: `npm run db:bootstrap` / `db:migrate` need tsx + the TS sources.

# (optional build secret `ca` = extra CA bundle, only for building behind a TLS-inspecting proxy; unused on the server)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
# Next builds against a throwaway local database dir; nothing from it is kept.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    PGLITE_DIR=/tmp/build-pglite FILES_DIR=/tmp/build-files npm run build && rm -rf /tmp/build-pglite /tmp/build-files

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    FILES_DIR=/data/files OUTBOX_LOG=/data/outbox.log
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/files && chown -R node:node /data
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
