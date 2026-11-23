#!/usr/bin/env bash
# Contract test for GitHub delivery policy ownership and read-only behavior.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/verify-github-delivery-policy.sh")"

for forbidden in \
  'expect_repository_setting()' \
  'expect_branch_setting()'; do
  printf '%s\n' "$script" | grep -Fq -- "$forbidden" \
    && { echo "verify-github-delivery-policy test: unowned helper remains: $forbidden" >&2; exit 1; }
done

for required in \
  'verify_github_repository_delivery_policy()' \
  'verify_github_branch_protection_policy()' \
  'verify_github_repository_delivery_policy allow_merge_commit false' \
  'verify_github_repository_delivery_policy allow_squash_merge true' \
  'verify_github_repository_delivery_policy delete_branch_on_merge true' \
  'for branch in main; do' \
  'verify_github_branch_protection_policy "$branch" allow_force_pushes.enabled false' \
  'verify_github_branch_protection_policy "$branch" required_pull_request_reviews missing' \
  'verify_github_branch_protection_policy "$branch" required_linear_history.enabled true'; do
  printf '%s\n' "$script" | grep -Fq -- "$required" \
    || { echo "verify-github-delivery-policy test: missing semantic owner contract: $required" >&2; exit 1; }
done

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
export GH="$fixture/gh" GITHUB_REPOSITORY="example/nook" POLICY_FIXTURE="$fixture"
cat > "$GH" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == api ]]
shift
if [[ "${1:-}" == --paginate ]]; then shift; fi
case "$1" in
  repos/example/nook) file=repo ;;
  repos/example/nook/branches/main/protection) file=classic ;;
  repos/example/nook/rules/branches/main) file=rules ;;
  repos/example/nook/rulesets/42) file=ruleset ;;
  *) exit 1 ;;
esac
[[ "$2" == --jq && "$#" == 3 ]]
jq -r "$3" "$POLICY_FIXTURE/$file"
MOCK
chmod +x "$GH"
echo '{"allow_merge_commit":false,"allow_squash_merge":true,"allow_rebase_merge":false,"delete_branch_on_merge":true}' > "$fixture/repo"
echo '{"allow_force_pushes":{"enabled":false},"allow_deletions":{"enabled":false},"required_linear_history":{"enabled":true}}' > "$fixture/classic"
echo '{"bypass_actors":[]}' > "$fixture/ruleset"
echo '[{"ruleset_id":42,"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[{"context":"PR validation / Merge readiness","integration_id":15368}]}}]' > "$fixture/valid"
cp "$fixture/valid" "$fixture/rules"
bash "$scripts_dir/verify-github-delivery-policy.sh" >/dev/null
for drift in '[]' '.[0].parameters.strict_required_status_checks_policy = false' \
    '.[0].parameters.required_status_checks[0].context = "PR validation / Draft verification and preview"' \
    'del(.[0].parameters.required_status_checks[0].integration_id)'; do
  jq "$drift" "$fixture/valid" > "$fixture/rules"
  if bash "$scripts_dir/verify-github-delivery-policy.sh" >/dev/null 2>&1; then
    echo "unexpected policy acceptance: $drift" >&2
    exit 1
  fi
done
cp "$fixture/valid" "$fixture/rules"
for bypass in '{"bypass_actors":[{"actor_type":"RepositoryRole"}]}' '{}'; do
  echo "$bypass" > "$fixture/ruleset"
  if bash "$scripts_dir/verify-github-delivery-policy.sh" >/dev/null 2>&1; then
    echo "unexpected policy acceptance: $bypass" >&2
    exit 1
  fi
done

echo 'verify-github-delivery-policy test: ok'
