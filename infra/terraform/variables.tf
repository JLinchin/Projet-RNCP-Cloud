variable "cluster_name" {
  description = "Nom du cluster kind"
  type        = string
  default     = "biblio"
}

variable "node_image" {
  description = "Image des nœuds kind (version de Kubernetes)"
  type        = string
  default     = "kindest/node:v1.33.1"
}

variable "worker_count" {
  description = "Nombre de nœuds workers (en plus du control-plane)"
  type        = number
  default     = 1
}

variable "registry_port" {
  description = "Port local du registre d'images (localhost:<port>)"
  type        = number
  default     = 5001
}

variable "admin_email" {
  description = "Compte administrateur initial de l'application"
  type        = string
  default     = "admin@biblio.local"
}

variable "grafana_host" {
  type    = string
  default = "grafana.localhost"
}

# Séparation des environnements (ISO 27001 A.8.31) : un namespace isolé par environnement,
# avec ses propres secrets, quotas, politiques réseau et compte de déploiement.
variable "environments" {
  description = "Environnements applicatifs à provisionner"
  type = map(object({
    host                  = string
    quota_cpu_requests    = string
    quota_memory_requests = string
    quota_cpu_limits      = string
    quota_memory_limits   = string
    postgres_storage      = string
    minio_storage         = string
    backup_schedule       = string
    backup_retention_days = number
  }))
  default = {
    dev = {
      host                  = "dev.library.localhost"
      quota_cpu_requests    = "1"
      quota_memory_requests = "1536Mi"
      quota_cpu_limits      = "6"
      quota_memory_limits   = "4Gi"
      postgres_storage      = "1Gi"
      minio_storage         = "1Gi"
      backup_schedule       = "0 3 * * 1-5"
      backup_retention_days = 7
    }
    prod = {
      host                  = "library.localhost"
      quota_cpu_requests    = "2"
      quota_memory_requests = "3Gi"
      quota_cpu_limits      = "8"
      quota_memory_limits   = "6Gi"
      postgres_storage      = "2Gi"
      minio_storage         = "5Gi"
      backup_schedule       = "0 2 * * *"
      backup_retention_days = 30
    }
  }
}

# Versions des charts : contraintes de version majeure, figées par le fichier de verrouillage Helm
# lors de l'installation. Mettre à jour volontairement (veille + test en dev).
variable "chart_versions" {
  type = map(string)
  default = {
    traefik               = "^37.0.0"
    metrics_server        = "^3.12.0"
    kube_prometheus_stack = "^75.0.0"
    loki                  = "^6.30.0"
    alloy                 = "^1.1.0"
  }
}
