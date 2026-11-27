# ---------------------------------------------------------------------------
# Environnements applicatifs (dev, prod) : namespace, secrets, réseau, quotas,
# compte de déploiement CI au moindre privilège et couche données.
# ---------------------------------------------------------------------------
locals {
  # Mots de passe générés : aucun secret saisi à la main ni versionné (A.5.17).
  generated_secrets = toset(["postgres_super", "postgres_app", "jwt", "admin", "rabbitmq", "minio_root", "s3_app", "s3_backup"])
  env_secret_pairs  = { for pair in setproduct(keys(var.environments), local.generated_secrets) : "${pair[0]}.${pair[1]}" => { env = pair[0], name = pair[1] } }
}

resource "random_password" "env" {
  for_each = local.env_secret_pairs
  length   = each.value.name == "jwt" ? 48 : 28
  special  = false # évite les problèmes d'échappement dans les URL de connexion
}

resource "random_bytes" "minio_kms" {
  for_each = var.environments
  length   = 32
}

resource "kubernetes_namespace" "env" {
  for_each = var.environments
  metadata {
    name = "library-${each.key}"
    labels = {
      environment = each.key
      # Pod Security Admission : « baseline » imposé, « restricted » signalé (avertissements + audit).
      "pod-security.kubernetes.io/enforce" = "baseline"
      "pod-security.kubernetes.io/warn"    = "restricted"
      "pod-security.kubernetes.io/audit"   = "restricted"
    }
  }
}

# ---------------------------- Secrets ----------------------------
resource "kubernetes_secret" "postgres" {
  for_each = var.environments
  metadata {
    name      = "library-postgres"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  data = {
    POSTGRES_PASSWORD = random_password.env["${each.key}.postgres_super"].result
    APP_DB_PASSWORD   = random_password.env["${each.key}.postgres_app"].result
  }
}

resource "kubernetes_secret" "app" {
  for_each = var.environments
  metadata {
    name      = "library-app"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  data = {
    JWT_SECRET     = random_password.env["${each.key}.jwt"].result
    ADMIN_EMAIL    = var.admin_email
    ADMIN_PASSWORD = random_password.env["${each.key}.admin"].result
  }
}

resource "kubernetes_secret" "rabbitmq" {
  for_each = var.environments
  metadata {
    name      = "library-rabbitmq"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  data = {
    RABBITMQ_USER     = "library"
    RABBITMQ_PASSWORD = random_password.env["${each.key}.rabbitmq"].result
  }
}

resource "kubernetes_secret" "minio_root" {
  for_each = var.environments
  metadata {
    name      = "library-minio-root"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  data = {
    MINIO_ROOT_USER      = "minio-root"
    MINIO_ROOT_PASSWORD  = random_password.env["${each.key}.minio_root"].result
    MINIO_KMS_SECRET_KEY = "library-kms:${random_bytes.minio_kms[each.key].base64}"
  }
}

resource "kubernetes_secret" "s3_app" {
  for_each = var.environments
  metadata {
    name      = "library-s3-app"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  data = {
    S3_ACCESS_KEY = "library-app"
    S3_SECRET_KEY = random_password.env["${each.key}.s3_app"].result
  }
}

resource "kubernetes_secret" "s3_backup" {
  for_each = var.environments
  metadata {
    name      = "library-s3-backup"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  data = {
    S3_ACCESS_KEY = "library-backup"
    S3_SECRET_KEY = random_password.env["${each.key}.s3_backup"].result
  }
}

resource "kubernetes_secret" "tls" {
  for_each = var.environments
  metadata {
    name      = "library-tls"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  type = "kubernetes.io/tls"
  data = {
    "tls.crt" = tls_locally_signed_cert.ingress.cert_pem
    "tls.key" = tls_private_key.ingress.private_key_pem
  }
}

# ---------------------------- Réseau ----------------------------
# Politique « deny-all » en entrée : seuls les flux ouverts explicitement par les charts passent.
resource "kubernetes_network_policy" "default_deny" {
  for_each = var.environments
  metadata {
    name      = "default-deny-ingress"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  spec {
    pod_selector {}
    policy_types = ["Ingress"]
  }
}

# ---------------------------- FinOps : quotas ----------------------------
resource "kubernetes_resource_quota" "env" {
  for_each = var.environments
  metadata {
    name      = "compute-quota"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"           = each.value.quota_cpu_requests
      "requests.memory"        = each.value.quota_memory_requests
      "limits.cpu"             = each.value.quota_cpu_limits
      "limits.memory"          = each.value.quota_memory_limits
      "persistentvolumeclaims" = "6"
      "requests.storage"       = "20Gi"
      "pods"                   = "40"
    }
  }
}

# Valeurs par défaut pour tout conteneur qui n'en déclarerait pas (évite les pods « illimités »).
resource "kubernetes_limit_range" "env" {
  for_each = var.environments
  metadata {
    name      = "default-limits"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  spec {
    limit {
      type            = "Container"
      default_request = { cpu = "25m", memory = "64Mi" }
      default         = { cpu = "250m", memory = "256Mi" }
    }
  }
}

# ---------------------------- IAM : compte de déploiement CI ----------------------------
# Moindre privilège (A.5.15 / A.8.2) : Role limité au namespace, sans accès aux Secrets
# (Helm est utilisé avec HELM_DRIVER=configmap), sans droits cluster.
resource "kubernetes_service_account" "ci" {
  for_each = var.environments
  metadata {
    name      = "ci-deployer"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  automount_service_account_token = false
}

resource "kubernetes_role" "ci" {
  for_each = var.environments
  metadata {
    name      = "ci-deployer"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  rule {
    api_groups = [""]
    resources  = ["configmaps", "services"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
  rule {
    api_groups = [""]
    resources  = ["pods", "pods/log", "events", "endpoints"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["apps"]
    resources  = ["deployments"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
  rule {
    api_groups = ["apps"]
    resources  = ["replicasets"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["autoscaling"]
    resources  = ["horizontalpodautoscalers"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
  rule {
    api_groups = ["policy"]
    resources  = ["poddisruptionbudgets"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses", "networkpolicies"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
  rule {
    api_groups = ["monitoring.coreos.com"]
    resources  = ["servicemonitors", "prometheusrules"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
  rule {
    api_groups = ["traefik.io"]
    resources  = ["middlewares"]
    verbs      = ["get", "list", "watch", "create", "update", "patch", "delete"]
  }
}

resource "kubernetes_role_binding" "ci" {
  for_each = var.environments
  metadata {
    name      = "ci-deployer"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.ci[each.key].metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.ci[each.key].metadata[0].name
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
  }
}

resource "kubernetes_secret" "ci_token" {
  for_each = var.environments
  metadata {
    name      = "ci-deployer-token"
    namespace = kubernetes_namespace.env[each.key].metadata[0].name
    annotations = {
      "kubernetes.io/service-account.name" = kubernetes_service_account.ci[each.key].metadata[0].name
    }
  }
  type                           = "kubernetes.io/service-account-token"
  wait_for_service_account_token = true
}

# kubeconfig restreint, à stocker comme secret du pipeline (KUBECONFIG_DEV / KUBECONFIG_PROD).
resource "local_sensitive_file" "ci_kubeconfig" {
  for_each        = var.environments
  filename        = "${local.generated_dir}/kubeconfig-ci-${each.key}"
  file_permission = "0600"
  content = yamlencode({
    apiVersion        = "v1"
    kind              = "Config"
    "current-context" = "ci-${each.key}"
    clusters = [{
      name = var.cluster_name
      cluster = {
        server                       = kind_cluster.this.endpoint
        "certificate-authority-data" = base64encode(kind_cluster.this.cluster_ca_certificate)
      }
    }]
    users = [{
      name = "ci-deployer-${each.key}"
      user = { token = kubernetes_secret.ci_token[each.key].data.token }
    }]
    contexts = [{
      name = "ci-${each.key}"
      context = {
        cluster   = var.cluster_name
        user      = "ci-deployer-${each.key}"
        namespace = kubernetes_namespace.env[each.key].metadata[0].name
      }
    }]
  })
}

# ---------------------------- Couche données ----------------------------
resource "helm_release" "data" {
  for_each  = var.environments
  name      = "library-data"
  chart     = "${path.module}/../../helm/library-data"
  namespace = kubernetes_namespace.env[each.key].metadata[0].name
  timeout   = 900

  values = [yamlencode({
    postgres = { storage = each.value.postgres_storage }
    minio    = { storage = each.value.minio_storage }
    backup = {
      schedule      = each.value.backup_schedule
      retentionDays = each.value.backup_retention_days
    }
  })]

  depends_on = [
    helm_release.monitoring, # CRD ServiceMonitor
    kubernetes_secret.postgres,
    kubernetes_secret.rabbitmq,
    kubernetes_secret.minio_root,
    kubernetes_secret.s3_app,
    kubernetes_secret.s3_backup,
    kubernetes_resource_quota.env,
  ]
}
