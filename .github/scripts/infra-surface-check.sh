#!/usr/bin/env bash
# Validate that the root Taskfile still exposes the Hive infrastructure surface.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

task_list="$(task --list)"
printf '%s\n' "$task_list" | grep -Fq 'infra:k0s:install'
printf '%s\n' "$task_list" | grep -Fq 'infra:kata:verify'
printf '%s\n' "$task_list" | grep -Fq 'infra:neo4j:deploy'
printf '%s\n' "$task_list" | grep -Fq 'infra:hive:deploy'
task infra:k0s:manifests:check
