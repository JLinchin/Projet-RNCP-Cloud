# Chiffrement en transit (ISO 27001 A.8.24) : une autorité de certification locale signe
# le certificat des points d'entrée HTTPS. Importer .generated/ca.crt dans le navigateur
# (ou utiliser curl --cacert) pour une chaîne de confiance complète.
resource "tls_private_key" "ca" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "ca" {
  private_key_pem       = tls_private_key.ca.private_key_pem
  is_ca_certificate     = true
  validity_period_hours = 24 * 365
  allowed_uses          = ["cert_signing", "crl_signing", "digital_signature"]

  subject {
    common_name  = "Biblio Local CA"
    organization = "Biblio"
  }
}

resource "tls_private_key" "ingress" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "ingress" {
  private_key_pem = tls_private_key.ingress.private_key_pem
  dns_names       = concat([for env in var.environments : env.host], [var.grafana_host])

  subject {
    common_name  = "library.localhost"
    organization = "Biblio"
  }
}

resource "tls_locally_signed_cert" "ingress" {
  cert_request_pem      = tls_cert_request.ingress.cert_request_pem
  ca_private_key_pem    = tls_private_key.ca.private_key_pem
  ca_cert_pem           = tls_self_signed_cert.ca.cert_pem
  validity_period_hours = 24 * 90 # rotation trimestrielle : terraform apply -replace=tls_locally_signed_cert.ingress
  early_renewal_hours   = 24 * 15
  allowed_uses          = ["digital_signature", "key_encipherment", "server_auth"]
}

resource "local_file" "ca_cert" {
  filename = "${local.generated_dir}/ca.crt"
  content  = tls_self_signed_cert.ca.cert_pem
}
