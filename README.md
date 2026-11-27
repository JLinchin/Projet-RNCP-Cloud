# Biblio — du code à la supervision

Application de **gestion de bibliothèque** (ouvrages, emprunts, retours) en Node.js, déployée et exploitée sur un **cluster Kubernetes 100 % local** : conteneurisation, orchestration, CI/CD, Terraform, observabilité, sécurité ISO 27001 et FinOps.

Projet de validation du bloc **BC3** du titre RNCP40875 *Expert en ingénierie des données* (compétences C6.1 → C8.2). Rapport : [`docs/RAPPORT.md`](docs/RAPPORT.md).

```
frontend/   SPA Vite servie par nginx non-root
backend/    API REST Express 5 stateless (JWT, PostgreSQL, S3, RabbitMQ, métriques Prometheus)
worker/     consommateur RabbitMQ : reçus PDF, notifications, relances, purge RGPD
helm/
  library-data/   PostgreSQL, RabbitMQ, MinIO, sauvegardes, NetworkPolicies (déployé par Terraform)
  library/        front, back, worker, HPA, PDB, canary, Ingress, SLO/alertes (déployé par la CI)
infra/terraform/  cluster kind, registre local, chiffrement etcd, PKI, Traefik, monitoring, environnements
scripts/          build/push, smoke tests, canary, charge, résilience, FinOps, restauration
docs/             rapport, SoA ISO 27001, FinOps, runbook
```

## Prérequis

Docker, Terraform ≥ 1.6, kubectl, Helm 3, jq, Node.js 22, make. Prévoir ~6 Go de RAM disponibles pour la plateforme complète (monitoring + 2 environnements). Le disque de l'hôte doit être chiffré (LUKS / BitLocker / FileVault) pour couvrir le chiffrement au repos des volumes.

## 1. En local avec docker compose

```bash
cp .env.example .env      # puis remplacer toutes les valeurs (openssl rand -base64 24)
make compose-up           # http://localhost:8080 — admin défini par ADMIN_EMAIL / ADMIN_PASSWORD
```

## 2. Plateforme Kubernetes locale (reproductible depuis zéro)

```bash
make infra                # terraform apply : cluster kind + registre + Traefik + monitoring + dev/prod
make deploy-dev           # build, scan, push des images (tag = SHA) puis helm upgrade --atomic + smoke tests
make deploy-prod          # canary puis promotion automatique
# ou tout en une commande : make all
```

| URL | Contenu |
|---|---|
| https://library.localhost | production |
| https://dev.library.localhost | développement |
| https://grafana.localhost | dashboards (SLO, jobs, FinOps, sécurité), logs Loki |

Mots de passe : `terraform -chdir=infra/terraform output -json app_admin_password` et `… output -raw grafana_admin_password`.
Certificat : importer `infra/terraform/.generated/ca.crt` (AC locale) dans le navigateur.

## 3. CI/CD (GitHub Actions)

`.github/workflows/ci-cd.yml` — sur chaque push : lint, tests, `npm audit`, Terraform/Helm lint, scan de secrets, build et scan Trivy des images. Sur `main` : déploiement dev puis prod (canary) depuis un **runner auto-hébergé** sur la machine du cluster (le cluster n'est jamais exposé).

Mise en place :
1. Installer un runner GitHub auto-hébergé avec les labels `self-hosted, linux, kind` sur la machine du cluster.
2. Créer les environnements GitHub `dev` et `production` (ce dernier avec **approbateurs requis**).
3. Secrets d'environnement : `KUBECONFIG_DEV` et `KUBECONFIG_PROD` = contenu de `infra/terraform/.generated/kubeconfig-ci-{dev,prod}` (comptes restreints au namespace, sans accès aux Secrets).
4. Variable de dépôt `CA_CERT_PATH` = chemin absolu de `ca.crt` sur la machine du runner.
5. Protection de `main` : PR obligatoire, 1 revue (CODEOWNERS), CI verte.

## 4. Démonstrations

| Commande | Démontre |
|---|---|
| `make test` / `make lint` | tests (17) et qualité |
| `make load-test` + `kubectl -n library-prod get hpa -w` | autoscaling horizontal |
| `make resilience` | suppression de pods, rolling update sous trafic, persistance PostgreSQL |
| `make finops` | capacité réservée/consommée et coût équivalent par namespace |
| `make measure-images` | gain des images optimisées vs Dockerfile naïf |
| `make backup-now` / `make restore` | sauvegarde chiffrée et restauration |

Procédures détaillées : [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Documentation

- [Rapport de projet](docs/RAPPORT.md) — architecture, choix justifiés, arbitrages, correspondance RNCP
- [Déclaration d'applicabilité ISO 27001](docs/SOA-ISO27001.md)
- [FinOps](docs/FINOPS.md)
- [Runbook](docs/RUNBOOK.md)
