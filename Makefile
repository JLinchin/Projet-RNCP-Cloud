# Raccourcis d'exploitation. Prérequis : docker, terraform, kubectl, helm, jq, node 22.
SHELL := /bin/bash
TF    := terraform -chdir=infra/terraform
TAG   ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
export HELM_DRIVER := configmap
export KUBECONFIG  ?= $(CURDIR)/infra/terraform/.generated/kubeconfig-admin

.PHONY: help test lint compose-up compose-down infra images deploy-dev deploy-prod all \
        smoke load-test resilience finops measure-images backup-now restore destroy

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

lint: ## Lint des 3 composants
	@for c in backend worker frontend; do (cd $$c && npm ci --silent && npm run lint) || exit 1; done

test: ## Tests unitaires des 3 composants
	@for c in backend worker frontend; do (cd $$c && npm ci --silent && npm test) || exit 1; done

compose-up: ## Lance toute la stack en local avec docker compose
	@test -f .env || (cp .env.example .env && echo ">> .env créé depuis .env.example : renseignez les secrets puis relancez" && exit 1)
	docker compose up --build -d && echo "Application : http://localhost:8080"

compose-down: ## Arrête la stack docker compose
	docker compose down

infra: ## Provisionne la plateforme (cluster kind, registre, monitoring, environnements)
	$(TF) init -input=false && $(TF) apply -auto-approve

images: ## Build + scan + push des images (TAG=<sha>)
	scripts/build-push.sh $(TAG)

deploy-dev: images ## Déploie l'application en dev
	helm upgrade --install library helm/library -n library-dev -f helm/library/values-dev.yaml --set image.tag=$(TAG) --atomic --wait --timeout 5m
	scripts/smoke-test.sh https://dev.library.localhost $(TAG)

deploy-prod: ## Déploie en prod via canary (après deploy-dev)
	scripts/canary.sh library-prod $(TAG) helm/library/values-prod.yaml https://library.localhost

all: infra deploy-dev deploy-prod ## Reconstruit TOUTE la plateforme depuis zéro

smoke: ## Tests de fumée sur la prod
	scripts/smoke-test.sh https://library.localhost

load-test: ## Charge sur l'API pour démontrer le HPA
	scripts/load-test.sh https://library.localhost 180 40

resilience: ## Suppression de pods, rolling update sous trafic, persistance
	scripts/resilience-test.sh library-prod https://library.localhost

finops: ## Rapport capacité réservée / consommée / coût équivalent
	scripts/finops-report.sh library-prod library-dev monitoring ingress

measure-images: ## Comparaison taille image naïve vs optimisée
	scripts/measure-images.sh

backup-now: ## Déclenche immédiatement une sauvegarde de la base de prod
	kubectl -n library-prod create job --from=cronjob/postgres-backup backup-manual-$$(date +%s)

restore: ## Restaure la dernière sauvegarde de prod
	scripts/restore-db.sh library-prod latest

destroy: ## Détruit toute la plateforme locale
	$(TF) destroy -auto-approve
