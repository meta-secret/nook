#!/usr/bin/env bash
# Validate that the root Taskfile still exposes the Hive infrastructure surface.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

task --list | grep -q 'infra:k0s:install'
task --list | grep -q 'infra:kata:verify'
task --list | grep -q 'infra:neo4j:deploy'
task --list | grep -q 'infra:hive:deploy'
task infra:k0s:manifests:check
