#!/bin/bash
set -euo pipefail

# Kubernetes masks sensitive procfs paths in Restricted Pods. Bubblewrap can
# still isolate the user, PID, mount, and network namespaces, but it cannot
# mount a second procfs over that masked tree. Codex exposes --no-proc for this
# exact nested-container case.
exec -a codex-linux-sandbox /usr/local/bin/hive --no-proc "$@"
