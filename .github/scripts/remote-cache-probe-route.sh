#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
raw_tasks="${2:-}"
output_file="${3:-}"
case "$mode" in
  --validate) ;;
  --github-output)
    : "${output_file:?--github-output requires an output file}"
    ;;
  *)
    echo "Usage: $0 --validate <tasks> | --github-output <tasks> <output>" >&2
    exit 2
    ;;
esac

contains_probe_namespace=""
IFS=',' read -r -a parsed_tasks <<< "$raw_tasks"
for parsed_task in "${parsed_tasks[@]}"; do
  if [[ "$parsed_task" == *cache:probe* ]]; then
    contains_probe_namespace=1
  fi
done

is_probe=false
profile=general
if [ -n "$contains_probe_namespace" ]; then
  case "$raw_tasks" in
    cache:probe:dependency-policy) profile=ecosystem-policy-tools ;;
    cache:probe:deterministic) profile=ecosystem-deterministic ;;
    cache:probe:dylint) profile=ecosystem-dylint ;;
    cache:probe:rust) profile=native ;;
    cache:probe:wasm|cache:probe:wasm-node) profile=wasm ;;
    cache:probe:web) profile=web-e2e ;;
    *)
      echo "A cache probe batch must be exactly one canonical cache:probe selector (got: ${raw_tasks:-empty})" >&2
      exit 2
      ;;
  esac
  is_probe=true
elif [ "$raw_tasks" = "build:compile" ]; then
  profile=compile
elif [ "$raw_tasks" = "loom:verify" ]; then
  profile=preflight
fi

if [ "$mode" = "--github-output" ]; then
  printf 'is_probe=%s\nprofile=%s\n' "$is_probe" "$profile" >> "$output_file"
fi
