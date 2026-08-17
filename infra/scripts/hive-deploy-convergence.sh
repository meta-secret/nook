#!/usr/bin/env bash

hive_active_graph_client_pods() {
  deployment="$1"
  kubectl get pods \
    --namespace hive-system \
    --selector "app.kubernetes.io/name=$deployment" \
    --output json |
    jq -r '
      .items[]
      | select(.metadata.deletionTimestamp == null)
      | select(.status.phase != "Succeeded" and .status.phase != "Failed")
      | .metadata.name
    '
}

hive_wait_for_graph_client_drain() {
  deployment="$1"
  attempts="$2"
  delay_seconds="$3"
  for attempt in $(seq 1 "$attempts"); do
    active_pods="$(hive_active_graph_client_pods "$deployment")"
    if test -z "$active_pods"; then
      return 0
    fi
    if test "$attempt" -eq "$attempts"; then
      echo "Timed out draining active graph client deployment/$deployment: $active_pods" >&2
      return 1
    fi
    sleep "$delay_seconds"
  done
}

hive_wait_for_ready_pool() {
  attempts="$1"
  delay_seconds="$2"
  stable_samples="$3"
  consecutive_ready=0
  ready_replicas=0
  for attempt in $(seq 1 "$attempts"); do
    ready_replicas="$(
      kubectl get deployment hive \
        --namespace hive-system \
        -o jsonpath='{.status.readyReplicas}'
    )"
    if test "$ready_replicas" = 4; then
      consecutive_ready=$((consecutive_ready + 1))
      if test "$consecutive_ready" -ge "$stable_samples"; then
        return 0
      fi
    else
      consecutive_ready=0
    fi
    if test "$attempt" -eq "$attempts"; then
      echo "Hive pool did not stabilize at four ready workers; last count: ${ready_replicas:-0}" >&2
      return 1
    fi
    sleep "$delay_seconds"
  done
}
