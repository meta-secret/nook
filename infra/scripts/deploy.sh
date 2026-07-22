#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
ssh_target="${INFRA_SSH_TARGET:-debian@188.165.236.156}"
remote_dir="${INFRA_REMOTE_DIR:-/home/debian/.local/share/nook-infra}"
compose_file="$repo_root/infra/compose.yaml"
remote_next="$remote_dir/compose.yaml.next"
remote_compose="$remote_dir/compose.yaml"

case "$remote_dir" in
  /home/*/.local/share/nook-infra) ;;
  *)
    echo "infra deploy: refusing unexpected remote directory: $remote_dir" >&2
    exit 2
    ;;
esac

docker compose -f "$compose_file" config --quiet
ssh -o BatchMode=yes "$ssh_target" "install -d -m 0750 '$remote_dir'"
scp -q -o BatchMode=yes "$compose_file" "$ssh_target:$remote_next"

ssh -o BatchMode=yes "$ssh_target" \
  "set -eu; \
   docker compose -f '$remote_next' config --quiet; \
   mv '$remote_next' '$remote_compose'; \
   docker compose -f '$remote_compose' pull; \
   docker compose -f '$remote_compose' up -d --remove-orphans --wait"

ssh -o BatchMode=yes "$ssh_target" \
  "set -eu; \
   test \"\$(docker compose -f '$remote_compose' exec -T redis redis-cli ping)\" = PONG; \
   curl --fail --silent --show-error http://127.0.0.1:5000/v2/ >/dev/null; \
   docker compose -f '$remote_compose' ps"
