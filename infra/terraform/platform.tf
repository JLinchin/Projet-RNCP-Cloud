# ---------------------------------------------------------------------------
# Socle de la plateforme : Ingress, métriques de ressources, observabilité
# ---------------------------------------------------------------------------
resource "kubernetes_namespace" "ingress" {
  metadata {
    name = "ingress"
    # Traefik utilise des hostPorts (80/443 du nœud), interdits au niveau « baseline ».
    labels = { "pod-security.kubernetes.io/enforce" = "privileged" }
  }
}

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
    # node-exporter a besoin d'accès hôte : niveau « privileged » limité à ce namespace.
    labels = { "pod-security.kubernetes.io/enforce" = "privileged" }
  }
}

# Contrôleur Ingress Traefik (ingress-nginx a été retiré par le projet Kubernetes en 2026).
resource "helm_release" "traefik" {
  name       = "traefik"
  repository = "https://traefik.github.io/charts"
  chart      = "traefik"
  version    = var.chart_versions.traefik
  namespace  = kubernetes_namespace.ingress.metadata[0].name
  wait       = true

  values = [yamlencode({
    deployment = { replicas = 1 }
    # Exposé sur les ports 80/443 du poste via les extraPortMappings du nœud control-plane.
    nodeSelector = { "node-role.kubernetes.io/control-plane" = "" }
    tolerations = [{
      key      = "node-role.kubernetes.io/control-plane"
      operator = "Exists"
      effect   = "NoSchedule"
    }]
    ports = {
      web       = { hostPort = 80 }
      websecure = { hostPort = 443 }
    }
    service      = { type = "ClusterIP" }
    ingressClass = { enabled = true, isDefaultClass = true }
    logs         = { access = { enabled = true, format = "json" } }
    resources = {
      requests = { cpu = "50m", memory = "64Mi" }
      limits   = { cpu = "500m", memory = "256Mi" }
    }
  })]
}

# metrics-server : alimente l'API metrics utilisée par le HorizontalPodAutoscaler.
resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  version    = var.chart_versions.metrics_server
  namespace  = "kube-system"

  values = [yamlencode({
    args = ["--kubelet-insecure-tls"] # certificats kubelet auto-signés dans kind
  })]

  depends_on = [kind_cluster.this]
}

resource "random_password" "grafana_admin" {
  length  = 24
  special = false
}

resource "kubernetes_secret" "grafana_tls" {
  metadata {
    name      = "grafana-tls"
    namespace = kubernetes_namespace.monitoring.metadata[0].name
  }
  type = "kubernetes.io/tls"
  data = {
    "tls.crt" = tls_locally_signed_cert.ingress.cert_pem
    "tls.key" = tls_private_key.ingress.private_key_pem
  }
}

# Prometheus + Alertmanager + Grafana + kube-state-metrics + node-exporter.
resource "helm_release" "monitoring" {
  name       = "monitoring"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = var.chart_versions.kube_prometheus_stack
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  timeout    = 900

  values = [yamlencode({
    # Composants non joignables dans kind : désactivés pour éviter de fausses alertes.
    kubeEtcd              = { enabled = false }
    kubeControllerManager = { enabled = false }
    kubeScheduler         = { enabled = false }
    kubeProxy             = { enabled = false }

    prometheus = {
      prometheusSpec = {
        # Découverte des ServiceMonitor / PrometheusRule de tous les namespaces applicatifs.
        serviceMonitorSelectorNilUsesHelmValues = false
        podMonitorSelectorNilUsesHelmValues     = false
        ruleSelectorNilUsesHelmValues           = false
        # FinOps : rétention bornée en durée ET en volume.
        retention     = "7d"
        retentionSize = "2GB"
        resources = {
          requests = { cpu = "100m", memory = "512Mi" }
          limits   = { memory = "1536Mi" }
        }
        storageSpec = {
          volumeClaimTemplate = {
            spec = {
              accessModes = ["ReadWriteOnce"]
              resources   = { requests = { storage = "3Gi" } }
            }
          }
        }
      }
    }

    alertmanager = {
      alertmanagerSpec = {
        resources = { requests = { cpu = "10m", memory = "32Mi" } }
      }
    }

    grafana = {
      adminPassword = random_password.grafana_admin.result
      ingress = {
        enabled          = true
        ingressClassName = "traefik"
        annotations = {
          "traefik.ingress.kubernetes.io/router.entrypoints" = "websecure"
          "traefik.ingress.kubernetes.io/router.tls"         = "true"
        }
        hosts = [var.grafana_host]
        tls   = [{ secretName = kubernetes_secret.grafana_tls.metadata[0].name, hosts = [var.grafana_host] }]
      }
      sidecar = {
        dashboards = { enabled = true, label = "grafana_dashboard", searchNamespace = "ALL" }
      }
      additionalDataSources = [{
        name   = "Loki"
        uid    = "loki"
        type   = "loki"
        access = "proxy"
        url    = "http://loki.${kubernetes_namespace.monitoring.metadata[0].name}.svc:3100"
      }]
    }
  })]

  depends_on = [helm_release.traefik]
}

# Loki (mode binaire unique, stockage fichier) : agrégation des logs, rétention 7 jours.
resource "helm_release" "loki" {
  name       = "loki"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki"
  version    = var.chart_versions.loki
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  timeout    = 600

  values = [yamlencode({
    deploymentMode = "SingleBinary"
    loki = {
      auth_enabled = false
      commonConfig = { replication_factor = 1 }
      storage      = { type = "filesystem" }
      schemaConfig = {
        configs = [{
          from         = "2024-04-01"
          store        = "tsdb"
          object_store = "filesystem"
          schema       = "v13"
          index        = { prefix = "loki_index_", period = "24h" }
        }]
      }
      limits_config = { retention_period = "168h" }
      compactor     = { retention_enabled = true, delete_request_store = "filesystem" }
    }
    singleBinary = {
      replicas    = 1
      persistence = { size = "2Gi" }
      resources   = { requests = { cpu = "50m", memory = "256Mi" }, limits = { memory = "768Mi" } }
    }
    backend      = { replicas = 0 }
    read         = { replicas = 0 }
    write        = { replicas = 0 }
    gateway      = { enabled = false }
    chunksCache  = { enabled = false }
    resultsCache = { enabled = false }
    lokiCanary   = { enabled = false }
    test         = { enabled = false }
    minio        = { enabled = false }
  })]
}

# Grafana Alloy : collecte des logs des pods via l'API Kubernetes (remplace Promtail, en fin de vie).
resource "helm_release" "alloy" {
  name       = "alloy"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "alloy"
  version    = var.chart_versions.alloy
  namespace  = kubernetes_namespace.monitoring.metadata[0].name

  values = [yamlencode({
    controller = { type = "deployment", replicas = 1 }
    alloy = {
      resources = { requests = { cpu = "20m", memory = "96Mi" }, limits = { memory = "256Mi" } }
      configMap = {
        content = <<-ALLOY
          discovery.kubernetes "pods" {
            role = "pod"
          }

          discovery.relabel "pods" {
            targets = discovery.kubernetes.pods.targets
            rule {
              source_labels = ["__meta_kubernetes_namespace"]
              target_label  = "namespace"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_name"]
              target_label  = "pod"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_container_name"]
              target_label  = "container"
            }
            rule {
              source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
              target_label  = "app"
            }
          }

          loki.source.kubernetes "pods" {
            targets    = discovery.relabel.pods.output
            forward_to = [loki.write.default.receiver]
          }

          loki.write "default" {
            endpoint {
              url = "http://loki.${kubernetes_namespace.monitoring.metadata[0].name}.svc:3100/loki/api/v1/push"
            }
          }
        ALLOY
      }
    }
  })]

  depends_on = [helm_release.loki]
}

# Tableau de bord applicatif (SLI/SLO, jobs, sécurité, FinOps) chargé par le sidecar Grafana.
resource "kubernetes_config_map" "dashboard_library" {
  metadata {
    name      = "dashboard-library"
    namespace = kubernetes_namespace.monitoring.metadata[0].name
    labels    = { grafana_dashboard = "1" }
  }
  data = {
    "library.json" = file("${path.module}/dashboards/library.json")
  }
}
