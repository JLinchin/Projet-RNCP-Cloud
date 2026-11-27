output "urls" {
  description = "Points d'entrée HTTPS"
  value = merge(
    { for env, cfg in var.environments : env => "https://${cfg.host}" },
    { grafana = "https://${var.grafana_host}" }
  )
}

output "registry" {
  value = "localhost:${var.registry_port}"
}

output "kubeconfig_admin" {
  description = "export KUBECONFIG=<chemin> pour administrer le cluster"
  value       = kind_cluster.this.kubeconfig_path
}

output "kubeconfig_ci" {
  description = "kubeconfig restreints (un par environnement) à enregistrer comme secrets du pipeline"
  value       = { for env, f in local_sensitive_file.ci_kubeconfig : env => f.filename }
}

output "ca_certificate" {
  value = local_file.ca_cert.filename
}

output "grafana_admin_password" {
  value     = random_password.grafana_admin.result
  sensitive = true
}

output "app_admin_password" {
  value     = { for env in keys(var.environments) : env => random_password.env["${env}.admin"].result }
  sensitive = true
}
