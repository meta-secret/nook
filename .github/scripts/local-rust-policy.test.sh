#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
policy="$repo_root/.github/scripts/local-rust-policy.sh"

fail() {
  echo "local-rust-policy test: $*" >&2
  exit 1
}

run_denied() {
  local output
  if output="$(env -u GITHUB_ACTIONS -u CI -u NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC bash "$policy" "$1" 2>&1)"; then
    fail "$1 was allowed on a local host"
  fi
  grep -Fq "Local Rust/WASM product execution is disabled" <<<"$output" || fail "$1 denial was not actionable"
  grep -Fq "task pr:validate PR=<number>" <<<"$output" || fail "$1 denial omitted complete remote validation guidance"
  grep -Fq "NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC=1" <<<"$output" || fail "$1 denial omitted the diagnostic override"
}

run_denied rust:test
run_denied wasm:build
run_denied setup
run_denied preflight:test

GITHUB_ACTIONS=true CI=true bash "$policy" rust:test || fail "trusted GitHub Actions was denied"
NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC=1 bash "$policy" rust:test || fail "explicit diagnostic override was denied"
if NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC=yes bash "$policy" rust:test >/dev/null 2>&1; then
  fail "non-literal diagnostic override was accepted"
fi

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
printf 'dummy-access\n' >"$fixture_root/access"
printf 'dummy-secret\n' >"$fixture_root/secret"
cat >"$fixture_root/docker" <<EOF
#!/usr/bin/env bash
touch "$fixture_root/docker-invoked"
exit 97
EOF
chmod +x "$fixture_root/docker"
if denial_output="$(
  env -u GITHUB_ACTIONS -u CI -u NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC \
    DOCKER="$fixture_root/docker" \
    SCCACHE_S3_ACCESS_KEY_FILE="$fixture_root/access" \
    SCCACHE_S3_SECRET_KEY_FILE="$fixture_root/secret" \
    task rust:test 2>&1
)"; then
  fail "task rust:test was allowed locally"
fi
grep -Fq "Local Rust/WASM product execution is disabled" <<<"$denial_output" || fail "task rust:test did not fail at the policy boundary"
[[ ! -e "$fixture_root/docker-invoked" ]] || fail "task rust:test touched Docker before local denial"

if GITHUB_ACTIONS=true CI=true \
  DOCKER="$fixture_root/docker" \
  SCCACHE_S3_ACCESS_KEY_FILE="$fixture_root/access" \
  SCCACHE_S3_SECRET_KEY_FILE="$fixture_root/secret" \
  task setup:rust:test >/dev/null 2>&1; then
  fail "trusted CI fixture unexpectedly completed"
fi
[[ -e "$fixture_root/docker-invoked" ]] || fail "trusted CI did not pass the Task policy boundary"
rm -f "$fixture_root/docker-invoked"

cat >"$fixture_root/cargo" <<EOF
#!/usr/bin/env bash
touch "$fixture_root/cargo-invoked"
exit 98
EOF
chmod +x "$fixture_root/cargo"
if env -u GITHUB_ACTIONS -u CI -u NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC \
  PATH="$fixture_root:$PATH" task preflight:source-architecture >/dev/null 2>&1; then
  fail "preflight:source-architecture was allowed locally"
fi
[[ ! -e "$fixture_root/cargo-invoked" ]] || fail "preflight:source-architecture invoked Cargo before local denial"

if NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC=1 PATH="$fixture_root:$PATH" \
  task _rust:build >/dev/null 2>&1; then
  fail "diagnostic fixture unexpectedly completed"
fi
[[ -e "$fixture_root/cargo-invoked" ]] || fail "diagnostic override did not pass the Task policy boundary"

task_block() {
  local file="$1"
  local task_name="$2"
  awk -v header="  ${task_name}:" '
    $0 == header { found = 1 }
    found && $0 != header && $0 ~ /^  [A-Za-z0-9_.:-]+:$/ { exit }
    found { print }
  ' "$repo_root/$file"
}

assert_guarded() {
  local file="$1"
  local task_name="$2"
  local block
  block="$(task_block "$file" "$task_name")"
  [[ -n "$block" ]] || fail "missing task $task_name in $file"
  grep -Fq '.github/scripts/local-rust-policy.sh' <<<"$block" || fail "$task_name bypasses the local Rust policy"
}

unguarded_boundaries="$({
  for file in \
    nook-app/Taskfile.yml \
    nook-app/nook-platform/Taskfile.yml \
    nook-app/nook-platform/docker/Taskfile.yml \
    nook-app/nook-platform/nook-wasm/Taskfile.yml \
    preflight/Taskfile.yml; do
    awk -v file="$file" '
      function check() {
        if (name == "") return
        compiles = body ~ /(cargo (build|test|fmt|clippy|nextest|llvm-cov)|wasm-pack (build|test)|buildx bake)/
        covered = body ~ /(local-rust-policy\.sh|_local-rust:prepare|task: setup|task setup|setup:rust)/
        if (compiles && !covered) print file ":" name
      }
      /^tasks:$/ { in_tasks = 1; next }
      in_tasks && /^  [A-Za-z0-9_.:-]+:$/ {
        check()
        name = $0
        sub(/^  /, "", name)
        sub(/:$/, "", name)
        body = ""
        next
      }
      in_tasks && name != "" { body = body "\n" $0 }
      END { check() }
    ' "$repo_root/$file"
  done
})"
[[ -z "$unguarded_boundaries" ]] || fail "unguarded compile boundaries:\n$unguarded_boundaries"

for task_name in setup setup:web:focused; do
  assert_guarded nook-app/Taskfile.yml "$task_name"
done

for task_name in \
  _rust:test:run _rust:coverage _rust:coverage:check _rust:coverage:update \
  _rust:format _rust:build _rust:lint setup:rust setup:rust:test \
  setup:rust:lint setup:rust:coverage setup:rust:fast setup:rust:browser; do
  assert_guarded nook-app/nook-platform/Taskfile.yml "$task_name"
done

for task_name in _wasm:build:run _wasm:test _wasm:test:browser; do
  assert_guarded nook-app/nook-platform/nook-wasm/Taskfile.yml "$task_name"
done

for task_name in \
  registry-cache:publish:local-format-deps docker:rust:task \
  docker:rust:browser:task docker:wasm:build:fast \
  docker:coverage:export docker:ci:rust:export docker:ci:wasm:export \
  docker:ci:wasm:node-test docker:ci:cache:publish:rust-base \
  docker:ci:cache:publish:native docker:ci:cache:publish:wasm docker:rust-base \
  docker:ecosystem:policy-tools docker:ecosystem:dependency-policy:run \
  docker:ecosystem:dependency-policy docker:ecosystem:deterministic \
  docker:ecosystem:kani docker:ecosystem:fuzz docker:ecosystem:dylint; do
  assert_guarded nook-app/nook-platform/docker/Taskfile.yml "$task_name"
done

for task_name in \
  preflight:test preflight:export preflight:source-architecture \
  preflight:typescript-state preflight:loom-contracts; do
  assert_guarded preflight/Taskfile.yml "$task_name"
done

for caller in build test lint check format:check; do
  task_block nook-app/Taskfile.yml "$caller" | grep -Fq setup || fail "$caller no longer reaches guarded setup"
done

for caller in web:build web:check web:test web:dev web:dev:fast; do
  task_block nook-app/nook-web/Taskfile.yml "$caller" | grep -Eq 'setup|setup:rust' || fail "$caller bypasses guarded setup"
done

for caller in ci-agent:run ci-agent:fix ci-agent:implement; do
  task_block .task/agentic-ai.yml "$caller" | grep -Fq setup || fail "$caller no longer reaches guarded setup"
done

format_block="$(task_block nook-app/Taskfile.yml format)"
grep -Fq '.github/scripts/format-host-apply.sh' <<<"$format_block" || fail "format no longer uses the host formatter"
if grep -Eq 'setup|cargo |wasm-pack|buildx' <<<"$format_block"; then
  fail "format gained a Rust/WASM build dependency"
fi

echo "local-rust-policy test: ok"
