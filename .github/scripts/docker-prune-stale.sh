#!/usr/bin/env bash
# Prune stale Docker build/image state on self-hosted runners.
#
# Keep one week of recent BuildKit/image state so local daemon builds can reuse
# expensive Rust and Chromium layers. Delivery CI itself uses ephemeral hosted
# builders plus GHA cache scopes; this age filter only bounds leftover host state.
# Docker does not support combining the age filter with --volumes.
# Keep the age-bound cache/image cleanup, then remove unused volumes
# separately (Docker volume prune has no supported age filter).
#
# Optional env:
#   GITHUB_STEP_SUMMARY — when set, appends a cleanup summary
set -euo pipefail

system_output="$(docker system prune --all --force --filter until=168h)"
volume_output="$(docker volume prune --force)"
output="$(printf '%s\n\n%s' "$system_output" "$volume_output")"
printf '%s\n' "$output"
reclaimed="$(printf '%s\n' "$output" | awk -F': ' '/^Total reclaimed space:/ { print $2; found=1 } END { if (!found) print "unknown" }')"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Docker cleanup"
    echo
    echo "Reclaimed space: \`$reclaimed\`"
    echo
    echo "<details>"
    echo "<summary>docker system prune output</summary>"
    echo
    echo '```text'
    printf '%s\n' "$output"
    echo '```'
    echo "</details>"
  } >> "$GITHUB_STEP_SUMMARY"
fi
