#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
static_checks="$repository_root/.task/static-checks.yml"
remote_batch="$repository_root/.github/scripts/remote-task-batch.sh"

static_check_body="$(awk '
  /^  static:check:/ { in_task = 1 }
  in_task && /^  [^[:space:]][^:]*:/ && $0 !~ /^  static:check:/ { exit }
  in_task { print }
' "$static_checks")"
type_check_body="$(awk '
  /^  type:check:/ { in_task = 1 }
  in_task { print }
' "$static_checks")"

case "$type_check_body" in
  *"bash .github/scripts/type-check-report.sh"*) ;;
  *)
    echo "type:check must invoke the hosted report script" >&2
    exit 1
    ;;
esac

for required_text in \
  'failed=0' \
  'task tooling:static || failed=1' \
  'task web:static || failed=1' \
  'exit "$failed"'; do
  case "$static_check_body" in
    *"$required_text"*) ;;
    *)
      echo "static:check is missing required aggregation behavior: $required_text" >&2
      exit 1
      ;;
  esac
done

grep -Fqx '    type:check) echo 30 ;;' <(sed -n '1,24p' "$remote_batch")

echo "universal type-check aggregation contract passed"
