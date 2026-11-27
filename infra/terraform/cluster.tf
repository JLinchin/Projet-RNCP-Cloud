locals {
  generated_dir = abspath("${path.module}/.generated")
  enc_dir       = "${local.generated_dir}/enc"
  certs_d_dir   = "${local.generated_dir}/certs.d"

  # Activation du chiffrement des Secrets dans etcd (ISO 27001 A.8.24).
  # Deux variantes : kind applique uniquement le patch dont l'apiVersion correspond
  # à la version de kubeadm utilisée par l'image de nœud.
  kubeadm_encryption_patch_v1beta3 = <<-YAML
    apiVersion: kubeadm.k8s.io/v1beta3
    kind: ClusterConfiguration
    apiServer:
      extraArgs:
        encryption-provider-config: /etc/kubernetes/enc/encryption-config.yaml
      extraVolumes:
        - name: enc
          hostPath: /etc/kubernetes/enc
          mountPath: /etc/kubernetes/enc
          readOnly: true
          pathType: DirectoryOrCreate
  YAML

  kubeadm_encryption_patch_v1beta4 = <<-YAML
    apiVersion: kubeadm.k8s.io/v1beta4
    kind: ClusterConfiguration
    apiServer:
      extraArgs:
        - name: encryption-provider-config
          value: /etc/kubernetes/enc/encryption-config.yaml
      extraVolumes:
        - name: enc
          hostPath: /etc/kubernetes/enc
          mountPath: /etc/kubernetes/enc
          readOnly: true
          pathType: DirectoryOrCreate
  YAML
}

# Clé AES-256 générée par Terraform (stockée uniquement dans l'état et sur le poste local).
resource "random_bytes" "etcd_encryption_key" {
  length = 32
}

resource "local_sensitive_file" "encryption_config" {
  filename        = "${local.enc_dir}/encryption-config.yaml"
  file_permission = "0600"
  content = yamlencode({
    apiVersion = "apiserver.config.k8s.io/v1"
    kind       = "EncryptionConfiguration"
    resources = [{
      resources = ["secrets"]
      providers = [
        { aescbc = { keys = [{ name = "key1", secret = random_bytes.etcd_encryption_key.base64 }] } },
        { identity = {} },
      ]
    }]
  })
}

# Miroir containerd : les nœuds tirent localhost:<port>/... depuis le conteneur « kind-registry ».
resource "local_file" "registry_hosts" {
  filename = "${local.certs_d_dir}/localhost:${var.registry_port}/hosts.toml"
  content  = <<-TOML
    [host."http://kind-registry:5000"]
      capabilities = ["pull", "resolve"]
  TOML
}

resource "kind_cluster" "this" {
  name            = var.cluster_name
  node_image      = var.node_image
  wait_for_ready  = true
  kubeconfig_path = "${local.generated_dir}/kubeconfig-admin"

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    containerd_config_patches = [
      <<-TOML
        [plugins."io.containerd.grpc.v1.cri".registry]
          config_path = "/etc/containerd/certs.d"
      TOML
    ]

    node {
      role = "control-plane"

      kubeadm_config_patches = [
        local.kubeadm_encryption_patch_v1beta3,
        local.kubeadm_encryption_patch_v1beta4,
      ]

      # Entrée HTTP(S) du poste vers Traefik (hostPort sur le control-plane).
      extra_port_mappings {
        container_port = 80
        host_port      = 80
        protocol       = "TCP"
      }
      extra_port_mappings {
        container_port = 443
        host_port      = 443
        protocol       = "TCP"
      }

      extra_mounts {
        host_path      = local.enc_dir
        container_path = "/etc/kubernetes/enc"
        read_only      = true
      }
      extra_mounts {
        host_path      = local.certs_d_dir
        container_path = "/etc/containerd/certs.d"
        read_only      = true
      }
    }

    dynamic "node" {
      for_each = range(var.worker_count)
      content {
        role = "worker"
        extra_mounts {
          host_path      = local.certs_d_dir
          container_path = "/etc/containerd/certs.d"
          read_only      = true
        }
      }
    }
  }

  depends_on = [local_sensitive_file.encryption_config, local_file.registry_hosts]
}

# ---------------------------------------------------------------------------
# Registre d'images local (aucun service cloud externe) connecté au réseau « kind »
# ---------------------------------------------------------------------------
resource "docker_image" "registry" {
  name         = "registry:2"
  keep_locally = true
}

resource "docker_container" "registry" {
  name    = "kind-registry"
  image   = docker_image.registry.image_id
  restart = "always"

  ports {
    internal = 5000
    external = var.registry_port
    ip       = "127.0.0.1"
  }

  networks_advanced {
    name = "kind"
  }

  depends_on = [kind_cluster.this]
}

# Documente le registre local pour les outils (KEP-1755).
resource "kubernetes_config_map" "local_registry_hosting" {
  metadata {
    name      = "local-registry-hosting"
    namespace = "kube-public"
  }
  data = {
    "localRegistryHosting.v1" = yamlencode({ host = "localhost:${var.registry_port}" })
  }
}
