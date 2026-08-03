#!/usr/bin/env bash
set -euo pipefail

# HIVE_AUTH_ROTATION_BEGIN
publish_hive_auth() {
  auth_file="$1"
  publication_mode="$2"
  staging_dir="${3:-}"
  cleanup_staged_auth() {
    rm -f "$auth_file"
    if test -n "$staging_dir"; then
      rmdir "$staging_dir" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_staged_auth EXIT
  mutation_lock="$remote_dir/hive-mutation.lock"
  exec 9>"$mutation_lock"
  flock --exclusive --timeout 900 9

  if test "$publication_mode" = bootstrap; then
    secret_ref="$(
      kubectl get secret hive-codex-auth \
        --namespace hive-system \
        --ignore-not-found \
        -o name
    )" || {
      echo "Hive Codex authentication bootstrap lookup failed" >&2
      return 1
    }
    case "$secret_ref" in
      secret/hive-codex-auth)
        cleanup_staged_auth
        trap - EXIT
        return
        ;;
      '') ;;
      *)
        echo "Unexpected Hive Codex authentication bootstrap lookup: $secret_ref" >&2
        return 1
        ;;
    esac
  fi

  original_replicas=""
  restore_hive_workers() {
    if test -n "$original_replicas"; then
      kubectl scale deployment/hive \
        --namespace hive-system \
        --replicas="$original_replicas"
      kubectl rollout status deployment/hive \
        --namespace hive-system \
        --timeout=10m
      original_replicas=""
    fi
  }
  cleanup_rotation() {
    cleanup_staged_auth
    restore_hive_workers
  }
  trap cleanup_rotation EXIT
  deployment_ref="$(
    kubectl get deployment hive \
      --namespace hive-system \
      --ignore-not-found \
      -o name
  )"
  case "$deployment_ref" in
    deployment.apps/hive)
      original_replicas="$(
        kubectl get deployment hive \
          --namespace hive-system \
          -o jsonpath='{.spec.replicas}'
      )"
      case "$original_replicas" in
        ''|*[!0-9]*)
          echo "Hive deployment has an invalid replica count" >&2
          return 1
          ;;
      esac
      kubectl scale deployment/hive \
        --namespace hive-system \
        --replicas=0
      kubectl rollout status deployment/hive \
        --namespace hive-system \
        --timeout=10m
      ;;
    '') ;;
    *)
      echo "Unexpected Hive deployment lookup: $deployment_ref" >&2
      return 1
      ;;
  esac
  pod_refs="$(
    kubectl get pod \
      --namespace hive-system \
      --selector app.kubernetes.io/name=hive \
      -o name
  )" || {
    echo "Hive Pod lookup failed while verifying worker quiescence" >&2
    return 1
  }
  if printf '%s\n' "$pod_refs" | grep -q .; then
    kubectl wait pod \
      --namespace hive-system \
      --selector app.kubernetes.io/name=hive \
      --for=delete \
      --timeout=10m
  fi
  kubectl create secret generic hive-codex-auth \
    --namespace hive-system \
    --from-file=auth.json="$auth_file" \
    --dry-run=client \
    -o yaml |
    kubectl apply -f -
  cleanup_staged_auth
  restore_hive_workers
  trap - EXIT
}
# HIVE_AUTH_ROTATION_END

publication_mode="${1:-}"
remote_dir="${2:-}"
case "$publication_mode" in
  bootstrap|replace) ;;
  *)
    echo "Hive Codex authentication publication mode is invalid" >&2
    exit 2
    ;;
esac
case "$remote_dir" in
  /*) ;;
  *)
    echo "Hive remote directory must be absolute" >&2
    exit 2
    ;;
esac

kubectl() { sudo -n k0s kubectl "$@"; }
staging_dir=""
cleanup_input() {
  if test -n "$staging_dir"; then
    rm -f "$staging_dir/auth.json"
    rmdir "$staging_dir" >/dev/null 2>&1 || true
  fi
}
trap cleanup_input EXIT
staging_dir="$(mktemp -d "$remote_dir/secrets/codex-auth-rotation.XXXXXX")"
auth_file="$staging_dir/auth.json"
cat >"$auth_file"
chmod 0600 "$auth_file"
jq -e '
  type == "object" and
  .auth_mode == "chatgpt" and
  (.tokens.access_token | type == "string" and length > 0) and
  (.tokens.refresh_token | type == "string" and length > 0) and
  (.tokens.account_id | type == "string" and length > 0)
' "$auth_file" >/dev/null
publish_hive_auth "$auth_file" "$publication_mode" "$staging_dir"
