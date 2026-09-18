#!/usr/bin/env bash
set -euo pipefail

report_root="${TYPE_CHECK_REPORT_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/nook-type-check-report}"
raw_root="$report_root/raw"
report_path="$report_root/report.yaml"
artifact_name="${TYPE_CHECK_ARTIFACT_NAME:-type-check-report}"

mkdir -p "$raw_root"

group_ids=(
  tooling-static
  web-static
)
group_labels=(
  "Tooling static"
  "Web static"
)
group_tasks=(
  tooling:static
  web:static
)
declare -a group_exit_codes=()
declare -a group_results=()
declare -a group_log_paths=()

run_type_check_group() {
  local group_id="$1"
  local group_label="$2"
  local task_name="$3"
  local log_path="$raw_root/$group_id.log"
  local status

  : > "$log_path"
  set +e
  task "$task_name" > "$log_path" 2>&1
  status=$?
  set -e

  group_exit_codes+=("$status")
  group_results+=("$([ "$status" -eq 0 ] && printf passed || printf failed)")
  group_log_paths+=("raw/$group_id.log")
  printf 'Type-check group %s (%s): %s (exit %s)\n' \
    "$group_id" "$group_label" "${group_results[${#group_results[@]}-1]}" "$status"
}

write_yaml_block_scalar() {
  local line
  printf 'summary: |\n'
  while IFS= read -r line || [ -n "$line" ]; do
    printf '  %s\n' "$line"
  done
}

run_type_check_group "${group_ids[0]}" "${group_labels[0]}" "${group_tasks[0]}"
run_type_check_group "${group_ids[1]}" "${group_labels[1]}" "${group_tasks[1]}"

overall_result=passed
for status in "${group_exit_codes[@]}"; do
  if [ "$status" -ne 0 ]; then
    overall_result=failed
    break
  fi
done

summary_text="$(
  printf '# Hosted type-check report\n\n'
  printf 'Overall: **%s**\n\n' "$overall_result"
  printf 'Groups:\n'
  for index in "${!group_ids[@]}"; do
    printf -- '- `%s` (%s): **%s** (exit %s)\n' \
      "${group_ids[$index]}" "${group_labels[$index]}" \
      "${group_results[$index]}" "${group_exit_codes[$index]}"
  done
  printf '\nArtifact: `%s`\n' "$artifact_name"
  printf 'Report path: `%s`\n' "$report_path"
  printf 'Raw group logs are referenced by `rawLog` in the YAML report.\n'
)"

{
  printf 'schemaVersion: 1\n'
  printf 'kind: "nook.type-check.report"\n'
  printf 'result: "%s"\n' "$overall_result"
  printf 'groups:\n'
  for index in "${!group_ids[@]}"; do
    printf '  - id: "%s"\n' "${group_ids[$index]}"
    printf '    label: "%s"\n' "${group_labels[$index]}"
    printf '    task: "%s"\n' "${group_tasks[$index]}"
    printf '    command: "task %s"\n' "${group_tasks[$index]}"
    printf '    result: "%s"\n' "${group_results[$index]}"
    printf '    exitCode: %s\n' "${group_exit_codes[$index]}"
    printf '    diagnostics: []\n'
    printf '    rawLog: "%s"\n' "${group_log_paths[$index]}"
  done
  printf '%s\n' "$summary_text" | write_yaml_block_scalar
} > "$report_path"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '## Hosted type-check report\n\n'
    printf '%s\n\n' "$summary_text"
    printf -- '- Artifact: `%s`\n' "$artifact_name"
    printf -- '- Report path: `%s`\n' "$report_path"
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$overall_result" = failed ]; then
  exit 1
fi
