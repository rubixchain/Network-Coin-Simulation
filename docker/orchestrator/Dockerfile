# Orchestrator (demo backend + UI). Build context = repo root.
FROM node:20-alpine
WORKDIR /app

COPY orchestrator/package.json ./
RUN npm install --omit=dev --no-fund --no-audit

COPY orchestrator/rubix.mjs orchestrator/stages.mjs orchestrator/server-v2.mjs \
     orchestrator/bootstrap-dids.mjs orchestrator/wire-network.mjs \
     orchestrator/wait-nodes.mjs orchestrator/entrypoint.sh ./
COPY orchestrator/public-v2 ./public-v2

ENV PORT=8080 DATA_DIR=/data NODE_HOST=localhost
RUN mkdir -p /data && chmod +x entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["sh", "entrypoint.sh"]
