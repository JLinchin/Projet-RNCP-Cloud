# syntax=docker/dockerfile:1
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:26-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production METRICS_PORT=9100
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="biblio-worker" org.opencontainers.image.version="${APP_VERSION}"
USER node
EXPOSE 9100
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:9100/healthz || exit 1
CMD ["node", "src/index.js"]
