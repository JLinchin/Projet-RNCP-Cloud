# syntax=docker/dockerfile:1
# ---------- Étape 1 : build Vite (outillage Node non embarqué dans l'image finale) ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ---------- Étape 2 : fichiers statiques servis par nginx non-root ----------
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
ENV BACKEND_URL=http://backend:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
