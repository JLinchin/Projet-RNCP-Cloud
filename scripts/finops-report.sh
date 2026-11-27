#!/usr/bin/env bash
# Rapport FinOps : capacité réservée (requests) vs consommée, valorisée avec une grille de prix
# de référence d'un cloud public (le cluster est local : il s'agit d'un coût d'opportunité).
# Usage : scripts/finops-report.sh [namespace...]    (prérequis : kubectl, jq, metrics-server)
set -euo pipefail
PRICE_VCPU_MONTH="${PRICE_VCPU_MONTH:-25}"   # €/vCPU/mois (hypothèse, VM généraliste à la demande)
PRICE_GB_MONTH="${PRICE_GB_MONTH:-3}"        # €/Go de RAM/mois (hypothèse)
PRICE_DISK_GB_MONTH="${PRICE_DISK_GB_MONTH:-0.10}" # €/Go de disque bloc/mois (hypothèse)
if [[ $# -gt 0 ]]; then NAMESPACES=("$@"); else NAMESPACES=(library-prod library-dev monitoring ingress); fi

to_cores() { awk '{v=$1; if (v ~ /m$/) {sub(/m$/,"",v); print v/1000} else print v+0}'; }
to_gib()   { awk '{v=$1; if (v ~ /Ki$/) {sub(/Ki/,"",v); print v/1048576} else if (v ~ /Mi$/) {sub(/Mi/,"",v); print v/1024} else if (v ~ /Gi$/) {sub(/Gi/,"",v); print v+0} else print v/1073741824}'; }

printf "%-14s %10s %10s %10s %10s %10s %12s\n" "namespace" "req CPU" "used CPU" "req RAM" "used RAM" "PVC Go" "€/mois (req)"
total=0
for ns in "${NAMESPACES[@]}"; do
  pods="$(kubectl -n "$ns" get pods --field-selector=status.phase=Running -o json)"
  req_cpu=$(echo "$pods" | jq -r '.items[].spec.containers[].resources.requests.cpu // "0"' | to_cores | awk '{s+=$1} END {print s+0}')
  req_mem=$(echo "$pods" | jq -r '.items[].spec.containers[].resources.requests.memory // "0"' | to_gib | awk '{s+=$1} END {print s+0}')
  used_cpu=$(kubectl -n "$ns" top pods --no-headers 2>/dev/null | awk '{print $2}' | to_cores | awk '{s+=$1} END {print s+0}')
  used_mem=$(kubectl -n "$ns" top pods --no-headers 2>/dev/null | awk '{print $3}' | to_gib | awk '{s+=$1} END {print s+0}')
  pvc=$(kubectl -n "$ns" get pvc -o json | jq -r '.items[].spec.resources.requests.storage' | to_gib | awk '{s+=$1} END {print s+0}')
  cost=$(awk -v c="$req_cpu" -v m="$req_mem" -v d="$pvc" -v pc="$PRICE_VCPU_MONTH" -v pm="$PRICE_GB_MONTH" -v pd="$PRICE_DISK_GB_MONTH" 'BEGIN {printf "%.2f", c*pc + m*1.074*pm + d*1.074*pd}')
  total=$(awk -v a="$total" -v b="$cost" 'BEGIN {print a+b}')
  printf "%-14s %10.3f %10.3f %9.2fG %9.2fG %10.1f %12s\n" "$ns" "$req_cpu" "$used_cpu" "$req_mem" "$used_mem" "$pvc" "$cost"
done
printf "Coût mensuel équivalent (requests + disques) : %.2f €  [%s €/vCPU, %s €/Go RAM, %s €/Go disque]\n" "$total" "$PRICE_VCPU_MONTH" "$PRICE_GB_MONTH" "$PRICE_DISK_GB_MONTH"
echo "Taux d'utilisation = used/req : un taux faible signale un sur-dimensionnement (gisement de right-sizing)."
