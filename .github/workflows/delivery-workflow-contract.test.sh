#!/usr/bin/env bash
# Static contract test for delivery workflow dispatch authority and evidence.
set -euo pipefail

workflows_dir="$(cd "$(dirname "$0")" && pwd)"
manager="$(cat "$workflows_dir/dev-pr-manager.yml")"
implement="$(cat "$workflows_dir/agent-implement.yml")"
dispatch_inputs="$(sed -n '/^  workflow_dispatch:/,/^permissions:/p' "$workflows_dir/agent-implement.yml")"
format_script="$(cat "$workflows_dir/../formatting/format-host-apply.sh")"
app_taskfile="$(cat "$workflows_dir/../../nook-app/Taskfile.yml")"
guest_taskfile="$(cat "$workflows_dir/../../.task/agentic-ai.yml")"
delivery_doc="$(cat "$workflows_dir/../../.cortex/gizmo-prime/architecture/dev-delivery.md")"

ruby -ryaml -e 'YAML.parse_file(ARGV.fetch(0))' "$workflows_dir/agent-implement.yml" >/dev/null

for input in pinned_local_dev_sha origin_main_sha; do
  input_block="$(printf '%s\n' "$dispatch_inputs" | awk -v input="$input" '
    $0 == "      " input ":" { found = 1; next }
    found && /^      [a-z_][a-z_]*:/ { exit }
    found { print }
  ')"
  printf '%s\n' "$input_block" | grep -Fq -- 'required: false' \
    || { echo "delivery workflow contract: $input must be optional dispatch metadata" >&2; exit 1; }
  printf '%s\n' "$input_block" | grep -Fq -- "default: ''" \
    || { echo "delivery workflow contract: $input must default to an empty optional value" >&2; exit 1; }
  printf '%s\n' "$input_block" | grep -Fq -- 'manager-authorized bootstrap evidence' \
    || { echo "delivery workflow contract: $input must identify manager-authorized bootstrap evidence" >&2; exit 1; }
done

for taskfile in "$app_taskfile" "$guest_taskfile"; do
  printf '%s\n' "$taskfile" | grep -Fq -- 'PINNED_LOCAL_DEV_SHA=<exact 40-character lowercase commit SHA>' \
    || { echo 'delivery workflow contract: task format must document its pinned local-dev SHA input' >&2; exit 1; }
  printf '%s\n' "$taskfile" | grep -Fq -- 'defaults to the current committed HEAD when omitted' \
    || { echo 'delivery workflow contract: task format must document its safe default base' >&2; exit 1; }
  printf '%s\n' "$taskfile" | grep -Fq -- 'pinned_local_dev_sha="${PINNED_LOCAL_DEV_SHA:-$(git' \
    || { echo 'delivery workflow contract: task format must derive a base when no workflow evidence is supplied' >&2; exit 1; }
  printf '%s\n' "$taskfile" | grep -Fq -- 'PINNED_LOCAL_DEV_SHA="$pinned_local_dev_sha"' \
    || { echo 'delivery workflow contract: task format must thread its derived base to the formatter' >&2; exit 1; }
done

for required in \
  '      expected_dev_sha:' \
  '        required: true' \
  '      controller:' \
  "      CONTROLLER: \${{ inputs.controller }}" \
  'if [[ "$CONTROLLER" != "dev-manager" ]]; then' \
  'Fetched origin/dev does not match the manager-selected expected SHA.' \
  'Selected origin/dev commit SHA: $DEV_SHA' \
  'Controller: $CONTROLLER'; do
  printf '%s\n' "$manager" | grep -Fq -- "$required" \
    || { echo "delivery workflow contract: manager misses $required" >&2; exit 1; }
done

for required in \
  'feature_branch:' \
  'description: Required prepublished canonical Prime feature branch; branch is dispatch authority' \
  'pinned_local_dev_sha:' \
  'description: "Optional manager-authorized bootstrap evidence: canonical local-dev base SHA"' \
  'origin_main_sha:' \
  'description: "Optional manager-authorized bootstrap evidence: fetched origin/main SHA"' \
  'FEATURE_BRANCH: ${{ inputs.feature_branch }}' \
  'refs/heads/$FEATURE_BRANCH:refs/remotes/origin/$FEATURE_BRANCH' \
  'ORIGIN_MAIN_SHA: ${{ inputs.origin_main_sha }}' \
  'PINNED_LOCAL_DEV_SHA: ${{ inputs.pinned_local_dev_sha }}'; do
  printf '%s\n' "$implement" | grep -Fq -- "$required" \
    || { echo "delivery workflow contract: implementation misses $required" >&2; exit 1; }
done
printf '%s\n' "$dispatch_inputs" | grep -Fq -- '      feature_head_sha:' \
  && { echo 'delivery workflow contract: feature head must be resolved from the branch, not dispatched as input' >&2; exit 1; }

for required in \
  '# Required input: PINNED_LOCAL_DEV_SHA is the exact local-dev commit used as the formatting base.' \
  'PINNED_LOCAL_DEV_SHA="$PINNED_LOCAL_DEV_SHA" FORMAT_CHANGED_FILES="$changed_files" task hive:guest:format:changed'; do
  printf '%s\n' "$format_script" | grep -Fq -- "$required" \
    || { echo "delivery workflow contract: formatter misses $required" >&2; exit 1; }
done

for required in \
  'The workflow packet must name controller `dev-manager` and carry the' \
  'Move remote main directly to the unchanged, fully validated dev commit.' \
  'Do not create a synthetic replacement commit (snapshot, merge, or' \
  'Verify that remote main equals that exact validated commit SHA.'; do
  printf '%s\n' "$delivery_doc" | grep -Fq -- "$required" \
    || { echo "delivery workflow contract: promotion documentation misses $required" >&2; exit 1; }
done

echo 'delivery workflow contract test: ok'
