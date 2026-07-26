#!/usr/bin/env bash

set -euo pipefail

remote_dir="${1:?remote repository directory is required}"
manifest="$remote_dir/infra/k0s/manifests/hive/network-policy.yaml"
kubectl() {
  sudo -n k0s kubectl "$@"
}

neo4j_service_ip="$(
  kubectl get service hive-neo4j \
    --namespace hive-data \
    -o jsonpath='{.spec.clusterIP}'
)"
neo4j_endpoint_ip="$(
  kubectl get endpoints hive-neo4j \
    --namespace hive-data \
    -o jsonpath='{.subsets[0].addresses[0].ip}'
)"
k0s_api_ip="$(
  kubectl get endpoints kubernetes \
    --namespace default \
    -o jsonpath='{.subsets[0].addresses[0].ip}'
)"
for discovered_ip in \
  "$neo4j_service_ip" \
  "$neo4j_endpoint_ip" \
  "$k0s_api_ip"; do
  case "$discovered_ip" in
    *[!0-9.]*|'')
      echo "Refusing invalid discovered cluster endpoint: $discovered_ip" >&2
      exit 1
      ;;
  esac
done

rendered="$(mktemp)"
trap 'rm -f "$rendered"' EXIT
sed \
  -e "s|HIVE_NEO4J_SERVICE_CIDR|$neo4j_service_ip/32|g" \
  -e "s|HIVE_NEO4J_ENDPOINT_CIDR|$neo4j_endpoint_ip/32|g" \
  -e "s|HIVE_K0S_API_CIDR|$k0s_api_ip/32|g" \
  "$manifest" > "$rendered"
kubectl apply -f "$rendered"
