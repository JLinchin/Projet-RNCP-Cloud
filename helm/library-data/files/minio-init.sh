#!/bin/sh
# Initialisation idempotente du stockage objet (utilisée par docker compose ET par le Job Kubernetes).
#  - buckets covers / receipts / backups
#  - chiffrement au repos SSE-S3 par défaut (ISO 27001 A.8.24)
#  - politique de conservation : expiration automatique des sauvegardes (C6.3 / A.8.13)
#  - comptes de service au moindre privilège (A.5.15 / A.8.2) :
#      * library-app    : lecture/écriture sur covers et receipts uniquement
#      * library-backup : dépôt (PutObject) dans backups uniquement, sans droit de suppression
set -eu

: "${MINIO_URL:?}" "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}"
: "${APP_ACCESS_KEY:?}" "${APP_SECRET_KEY:?}" "${BACKUP_ACCESS_KEY:?}" "${BACKUP_SECRET_KEY:?}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
export MC_CONFIG_DIR=/tmp/.mc

until mc alias set local "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "attente de MinIO..."; sleep 2
done

for b in covers receipts backups; do
  mc mb --ignore-existing "local/$b"
  mc encrypt set sse-s3 "local/$b"
done

cat > /tmp/lifecycle.json <<JSON
{"Rules":[{"ID":"expire-backups","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":${RETENTION_DAYS}}}]}
JSON
mc ilm import local/backups < /tmp/lifecycle.json

cat > /tmp/app-policy.json <<'JSON'
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],
   "Resource":["arn:aws:s3:::covers/*","arn:aws:s3:::receipts/*"]}]}
JSON
cat > /tmp/backup-policy.json <<'JSON'
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:PutObject"],"Resource":["arn:aws:s3:::backups/*"]},
  {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::backups"]}]}
JSON

mc admin policy create local library-app /tmp/app-policy.json
mc admin policy create local library-backup /tmp/backup-policy.json
mc admin user add local "$APP_ACCESS_KEY" "$APP_SECRET_KEY"
mc admin user add local "$BACKUP_ACCESS_KEY" "$BACKUP_SECRET_KEY"
mc admin policy attach local library-app --user "$APP_ACCESS_KEY" 2>/dev/null || true
mc admin policy attach local library-backup --user "$BACKUP_ACCESS_KEY" 2>/dev/null || true

echo "stockage objet initialisé (rétention des sauvegardes : ${RETENTION_DAYS} jours)"
