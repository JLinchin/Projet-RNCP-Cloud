# syntax=docker/dockerfile:1
# ---------- Étape 1 : dépendances de production uniquement ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- Étape 2 : image d'exécution minimale ----------
FROM node:22-alpine AS runtime
# npm/yarn/corepack sont inutiles à l'exécution : on les retire
# (-40 Mo environ et moins de CVE remontées par le scan Trivy).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="biblio-backend" org.opencontainers.image.version="${APP_VERSION}"
# Utilisateur non privilégié (UID 1000) — aucun secret dans l'image, tout passe par l'environnement.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
