# Live preview server for database editors. See preview/README.md.
# Build from the astro/ folder:  docker build -f preview/Dockerfile -t se-preview .
# CI publishes it to ghcr.io/hahn-kev/scriptureearth-preview (.github/workflows/preview-image.yml).
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    ASTRO_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && mkdir /app && chown node:node /app

# Run as node from here on. Each preview writes content/, dist/, .astro/ and
# public/search-index.txt in /app, so node must own it. Owning the files from
# the start (not a `chown -R` at the end) keeps node_modules in one layer.
WORKDIR /app
USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Dev dependencies too: the extract step uses d3-geo (world map) at run time.
# The pnpm store is removed after install; node_modules keeps the files.
RUN pnpm install --frozen-lockfile --prod=false \
 && rm -rf "$(pnpm store path)" /home/node/.cache/pnpm

COPY --chown=node:node . .

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "preview/server.mjs"]
