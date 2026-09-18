#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
report_script="$repository_root/.github/scripts/type-check-report.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/nook-type-check-report-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

stub_bin="$test_root/bin"
mkdir -p "$stub_bin"
stub_task="$stub_bin/task"
invocations="$test_root/invocations.log"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -u' \
  'task_name="${1:-}"' \
  'printf "%s\\n" "$task_name" >> "$STUB_TASK_INVOCATIONS"' \
  'case "$task_name" in' \
  '  tooling:static)' \
  '    printf "%s\\n" "tooling: colon: [quoted] # raw" "second line"' \
  '    exit "${STUB_TOOLING_STATUS:-0}"' \
  '    ;;' \
  '  web:static)' \
  '    printf "%s\\n" "web: colon: [quoted] # raw" "second line"' \
  '    exit "${STUB_WEB_STATUS:-0}"' \
  '    ;;' \
  '  *)' \
  '    printf "%s\\n" "unexpected task: $task_name" >&2' \
  '    exit 99' \
  '    ;;' \
  'esac' > "$stub_task"
chmod +x "$stub_task"

run_report() {
  local report_dir="$1"
  local summary_path="$2"
  local expected_status="$3"
  local actual_status

  set +e
  PATH="$stub_bin:$PATH" \
    STUB_TASK_INVOCATIONS="$invocations" \
    TYPE_CHECK_REPORT_DIR="$report_dir" \
    TYPE_CHECK_ARTIFACT_NAME="remote-type-check-123-2" \
    GITHUB_STEP_SUMMARY="$summary_path" \
    STUB_TOOLING_STATUS="${STUB_TOOLING_STATUS:-0}" \
    STUB_WEB_STATUS="${STUB_WEB_STATUS:-0}" \
    bash "$report_script"
  actual_status=$?
  set -e

  if [ "$actual_status" -ne "$expected_status" ]; then
    echo "type-check-report test: expected status $expected_status, got $actual_status" >&2
    exit 1
  fi
}

pass_dir="$test_root/pass"
pass_summary="$test_root/pass-summary.md"
: > "$pass_summary"
STUB_TOOLING_STATUS=0 STUB_WEB_STATUS=0 run_report "$pass_dir" "$pass_summary" 0

grep -Fqx 'tooling:static' "$invocations"
grep -Fqx 'web:static' "$invocations"
grep -Fq 'result: "passed"' "$pass_dir/report.yaml"
grep -Fq 'summary: |' "$pass_dir/report.yaml"
grep -Fq 'Artifact: `remote-type-check-123-2`' "$pass_summary"

pass_tooling_log='tooling: colon: [quoted] # raw
second line'
pass_web_log='web: colon: [quoted] # raw
second line'
printf '%s\n' "$pass_tooling_log" | cmp -s - "$pass_dir/raw/tooling-static.log"
printf '%s\n' "$pass_web_log" | cmp -s - "$pass_dir/raw/web-static.log"

if ! ruby -ryaml -e '
  report = YAML.load_file(ARGV.fetch(0))
  abort "unexpected schema" unless report.fetch("schemaVersion") == 1
  abort "unexpected groups" unless report.fetch("groups").length == 2
  abort "missing raw log" unless report.fetch("groups").all? { |group| group.fetch("rawLog").start_with?("raw/") }
' "$pass_dir/report.yaml"; then
  echo 'type-check-report test: generated pass report is not valid YAML' >&2
  exit 1
fi

: > "$invocations"
fail_dir="$test_root/fail"
fail_summary="$test_root/fail-summary.md"
: > "$fail_summary"
STUB_TOOLING_STATUS=7 STUB_WEB_STATUS=9 run_report "$fail_dir" "$fail_summary" 1

grep -Fq 'result: "failed"' "$fail_dir/report.yaml"
grep -Fq 'id: "tooling-static"' "$fail_dir/report.yaml"
grep -Fq 'exitCode: 7' "$fail_dir/report.yaml"
grep -Fq 'id: "web-static"' "$fail_dir/report.yaml"
grep -Fq 'exitCode: 9' "$fail_dir/report.yaml"
grep -Fq 'Overall: **failed**' "$fail_summary"

invocation_count="$(wc -l < "$invocations")"
if [ "$invocation_count" -ne 2 ]; then
  echo "type-check-report test: expected both groups after failure, got $invocation_count invocation(s)" >&2
  exit 1
fi

printf '%s\n' "$pass_tooling_log" | cmp -s - "$fail_dir/raw/tooling-static.log"
printf '%s\n' "$pass_web_log" | cmp -s - "$fail_dir/raw/web-static.log"

if ! ruby -ryaml -e '
  report = YAML.load_file(ARGV.fetch(0))
  abort "unexpected result" unless report.fetch("result") == "failed"
  groups = report.fetch("groups")
  abort "failure was not retained" unless groups.map { |group| group.fetch("exitCode") } == [7, 9]
  abort "summary was not decoded" unless report.fetch("summary").include?("Overall: **failed**")
' "$fail_dir/report.yaml"; then
  echo 'type-check-report test: generated failure report is not valid YAML' >&2
  exit 1
fi

echo 'type-check-report test: pass/fail aggregation, YAML, and raw logs passed'
