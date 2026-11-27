#!/usr/bin/env bash
# Restauration d'une sauvegarde PostgreSQL depuis le stockage objet (ISO 27001 A.8.13).
# Opération privilégiée : utilise le compte racine MinIO (le compte de sauvegarde ne peut
# qu'écrire) -> séparation des tâches. À exécuter avec le kubeconfig administrateur.
# Usage : scripts/restore-db.sh <namespace> [nom_du_dump|latest]
set -euo pipefail
NS="${1:?namespace}"; DUMP="${2:-latest}"
kubectl -n "$NS" delete job postgres-restore --ignore-not-found
kubectl -n "$NS" apply -f - <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: postgres-restore
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels: { biblio/db-access: "true", biblio/s3-access: "true" }
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext: { runAsNonRoot: true, runAsUser: 70, runAsGroup: 70, fsGroup: 70 }
      initContainers:
        - name: fetch
          image: pgsty/mc:latest
          command: ["/bin/sh", "-c"]
          args:
            - |
              mc alias set s3 http://minio:9000 "\$MINIO_ROOT_USER" "\$MINIO_ROOT_PASSWORD" >/dev/null
              if [ "$DUMP" = "latest" ]; then F=\$(mc ls s3/backups/postgres/ | awk '{print \$NF}' | sort | tail -1); else F="$DUMP"; fi
              echo "restauration de \$F"; mc cp "s3/backups/postgres/\$F" /restore/db.dump
          env:
            - { name: MC_CONFIG_DIR, value: /tmp/.mc }
            - name: MINIO_ROOT_USER
              valueFrom: { secretKeyRef: { name: library-minio-root, key: MINIO_ROOT_USER } }
            - name: MINIO_ROOT_PASSWORD
              valueFrom: { secretKeyRef: { name: library-minio-root, key: MINIO_ROOT_PASSWORD } }
          resources: { requests: { cpu: 10m, memory: 32Mi }, limits: { cpu: 200m, memory: 128Mi } }
          volumeMounts: [{ name: restore, mountPath: /restore }, { name: tmp, mountPath: /tmp }]
      containers:
        - name: restore
          image: postgres:16.9-alpine
          command: ["pg_restore", "--clean", "--if-exists", "--no-owner", "-h", "postgres", "-U", "library_app", "-d", "library", "/restore/db.dump"]
          env:
            - name: PGPASSWORD
              valueFrom: { secretKeyRef: { name: library-postgres, key: APP_DB_PASSWORD } }
          resources: { requests: { cpu: 50m, memory: 64Mi }, limits: { cpu: 500m, memory: 256Mi } }
          volumeMounts: [{ name: restore, mountPath: /restore }]
      volumes:
        - { name: restore, emptyDir: {} }
        - { name: tmp, emptyDir: {} }
YAML
kubectl -n "$NS" wait --for=condition=complete job/postgres-restore --timeout=300s
kubectl -n "$NS" logs job/postgres-restore --all-containers
