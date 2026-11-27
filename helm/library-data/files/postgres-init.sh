#!/bin/sh
# Exécuté une seule fois à l'initialisation du volume PostgreSQL.
# Crée un rôle applicatif NON superutilisateur, propriétaire de sa seule base
# (moindre privilège, ISO 27001 A.8.2). Les valeurs viennent des Secrets (jamais en dur).
set -eu
psql -v ON_ERROR_STOP=1 -v app_user="$APP_DB_USER" -v app_pw="$APP_DB_PASSWORD" -v app_db="$APP_DB_NAME" \
     --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE :"app_db" OWNER :"app_user";
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
SQL
