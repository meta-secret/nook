#!/usr/bin/env bash
# Contract test for the shared tool-only formatter image.
set -euo pipefail

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
script="$(cat "$scripts_dir/format-host-apply.sh")"
formatter_dir="$scripts_dir/../formatting"
dockerfile="$(cat "$formatter_dir/Dockerfile")"
formatter="$(cat "$formatter_dir/format.sh")"
agentic_taskfile="$(cat "$scripts_dir/../../.task/agentic-ai.yml")"
web_package="$(cat "$scripts_dir/../../nook-app/nook-web/nook-web-app/package.json")"
loom_package="$(cat "$scripts_dir/../../agentic-ai/loom/package.json")"
guest_changed_formatter="$(
  printf '%s\n' "$agentic_taskfile" \
    | sed -n '/^  hive:guest:format:changed:/,/^  hive:guest:format:/p'
)"
guest_formatter="$(
  printf '%s\n' "$agentic_taskfile" \
    | sed -n '/^  hive:guest:format:/,/^  hive:guest:pr:ready:/p'
)"

printf '%s\n' "$script" | grep -q 'formatter_image="nook-source-formatter:' \
  || { echo 'format-host-apply test: expected shared content-addressed image' >&2; exit 1; }
for hash_input in Dockerfile package.json bun.lock prettier-default.json prettier-shared-typescript.json prettier-web.json format.sh; do
  printf '%s\n' "$script" | grep -Fq "$hash_input" \
    || { echo "format-host-apply test: formatter hash misses $hash_input" >&2; exit 1; }
done
printf '%s\n' "$script" | grep -Fq '(cd "$formatter_dir" && \' \
  || { echo 'format-host-apply test: formatter hash must be worktree-independent' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'docker image inspect "$formatter_image"' \
  || { echo 'format-host-apply test: expected warm image reuse' >&2; exit 1; }
printf '%s\n' "$script" | grep -q '"$formatter_dir"' \
  || { echo 'format-host-apply test: build context must be formatter-only' >&2; exit 1; }
printf '%s\n' "$script" | grep -q 'docker run' \
  || { echo 'format-host-apply test: expected formatter container' >&2; exit 1; }
printf '%s\n' "$script" | grep -q '/tmp/nook-format-files:ro' \
  || { echo 'format-host-apply test: expected bounded changed-file input' >&2; exit 1; }
for required in \
  'git diff --name-only --diff-filter=ACMR -z "$base_ref"' \
  'git ls-files --others --exclude-standard -z' \
  'FORMAT_CHANGED_FILES="$changed_files" task hive:guest:format:changed'; do
  printf '%s\n' "$script" | grep -Fq "$required" \
    || { echo "format-host-apply test: canonical changed-file selection misses $required" >&2; exit 1; }
done
printf '%s\n' "$script" | grep -q 'task hive:guest:format:changed' \
  || { echo 'format-host-apply test: expected changed-only native Hive guest formatter' >&2; exit 1; }

for forbidden in buildx registry-cache format:diff setup:rust cargo\ fmt bun\ install; do
  printf '%s\n' "$script" | grep -Fq "$forbidden" \
    && { echo "format-host-apply test: forbidden heavy path: $forbidden" >&2; exit 1; }
done

for required in \
  'rustup component add rustfmt' \
  'bun install --frozen-lockfile --ignore-scripts'; do
  printf '%s\n' "$dockerfile" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing formatter image contract: $required" >&2; exit 1; }
done
for prohibited in 'COPY .' 'nook-app/' 'agentic-ai/' 'cargo build' 'cargo test'; do
  printf '%s\n' "$dockerfile" | grep -Fq "$prohibited" \
    && { echo "format-host-apply test: product work in formatter image: $prohibited" >&2; exit 1; }
done
for manifest in \
  nook-app/nook-platform/Cargo.toml \
  preflight/Cargo.toml \
  agentic-ai/minds/Cargo.toml; do
  printf '%s\n' "$formatter" | grep -Fq "$manifest" \
    || { echo "format-host-apply test: missing Rust formatter: $manifest" >&2; exit 1; }
done
printf '%s\n' "$formatter" | grep -Fq 'prettier-plugin-svelte' \
  || { echo 'format-host-apply test: missing Svelte formatter' >&2; exit 1; }
for required in \
  'nook-app/nook-web/nook-web-shared/src/vault-app/*.ts' \
  'web_shared_typescript_files+=' \
  'prettier-shared-typescript.json' \
  '"${web_shared_typescript_files[@]}"'; do
  printf '%s\n' "$formatter" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing shared TypeScript formatter contract: $required" >&2; exit 1; }
done
for required in \
  '.agents/skills/*' \
  'executable_skill_files+=' \
  '"$repo_root/.agents/skills"' \
  'tooling/eslint-rules/no-raw-object-arguments.js' \
  'shared_tooling_files+=' \
  'done </tmp/nook-format-files'; do
  printf '%s\n' "$formatter" | grep -Fq "$required" \
    || { echo "format-host-apply test: missing executable-skill formatter contract: $required" >&2; exit 1; }
done

for required in \
  'cd nook-app/nook-web/nook-web-app && bun install --frozen-lockfile' \
  'nook-app/nook-web/nook-web-app/node_modules/.bin/prettier' \
  'rustfmt --edition 2024 --config skip_children=true -- "${rust_files[@]}"' \
  'web_app_files+=' \
  'web_shared_typescript_files+=' \
  'extension_files+=' \
  'research_files+=' \
  'hive_console_files+=' \
  'loom_files+=' \
  'done <"$FORMAT_CHANGED_FILES"' \
  'skill_files+=("${file_name#.agents/skills/}")' \
  'tooling/eslint-rules/no-raw-object-arguments.js' \
  'prettier-web.json' \
  'prettier-default.json' \
  'prettier-shared-typescript.json' \
  'format_changed_files "$default_config" "$repo_root/.agents/skills"' \
  'format_changed_files "$default_config" "$repo_root"' \
  '-- "$@"'; do
  printf '%s\n' "$guest_changed_formatter" | grep -Fq -- "$required" \
    || { echo "format-host-apply test: sealed guest misses skill formatter contract: $required" >&2; exit 1; }
done
for package in "$web_package" "$loom_package"; do
  printf '%s\n' "$package" | grep -Fq '"prettier": "3.9.6"' \
    || { echo 'format-host-apply test: skill formatter Prettier version is not pinned consistently' >&2; exit 1; }
done
for loom_format_contract in \
  '"format": "prettier --config .prettierrc' \
  '"format:check": "prettier --config .prettierrc'; do
  printf '%s\n' "$loom_package" | grep -Fq "$loom_format_contract" \
    || { echo 'format-host-apply test: Loom tooling formatter does not use its pinned config' >&2; exit 1; }
done
for forbidden in 'task skills:format' 'task skills:install' '.agents/skills && bun install' '.agents/skills/*/src/**/*.ts'; do
  printf '%s\n%s\n' "$guest_formatter" "$guest_changed_formatter" | grep -Fq -- "$forbidden" \
    && { echo "format-host-apply test: sealed guest skill formatting recurses or installs: $forbidden" >&2; exit 1; }
done

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
mkdir -p \
  "$fixture_root/.agents/skills/demo/src" \
  "$fixture_root/agentic-ai/loom/src" \
  "$fixture_root/agentic-ai/minds/hive-console/src" \
  "$fixture_root/agentic-ai/minds/hive/src" \
  "$fixture_root/.github/scripts" \
  "$fixture_root/.github/formatting" \
  "$fixture_root/.task" \
  "$fixture_root/bin" \
  "$fixture_root/nook-app/nook-platform/src" \
  "$fixture_root/nook-app/nook-web/nook-web-app/node_modules/.bin" \
  "$fixture_root/nook-app/nook-web/nook-web-app/node_modules/prettier-plugin-svelte" \
  "$fixture_root/nook-app/nook-web/nook-web-app/src" \
  "$fixture_root/nook-app/nook-web/nook-web-extension/src" \
  "$fixture_root/nook-app/nook-web/nook-web-research/src" \
  "$fixture_root/nook-app/nook-web/nook-web-shared/src/vault-app" \
  "$fixture_root/nook-app/nook-web/nook-vault-simple/src" \
  "$fixture_root/nook-app/nook-web/nook-vault-sentinel/src" \
  "$fixture_root/preflight/src" \
  "$fixture_root/tooling/eslint-rules"
cp "$scripts_dir/format-host-apply.sh" "$fixture_root/.github/scripts/format-host-apply.sh"
cp "$scripts_dir/../../.task/agentic-ai.yml" "$fixture_root/.task/agentic-ai.yml"
cat >"$fixture_root/bin/task" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
test "$#" -eq 1 && test "$1" = hive:guest:format:changed
exec "$FORMAT_TEST_REAL_TASK" \
  --taskfile "$PWD/.task/agentic-ai.yml" \
  "$@"
EOF
cat >"$fixture_root/bin/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FORMAT_TEST_INSTALL_LOG"
test "$#" -eq 2 && test "$1" = install && test "$2" = --frozen-lockfile
: >"$FORMAT_TEST_READY"
EOF
cat >"$fixture_root/bin/rustfmt" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
test "$#" -ge 6 && test "$1" = --edition && test "$2" = 2024
test "$3" = --config && test "$4" = skip_children=true && test "$5" = --
shift 5
printf '%s\n' "$@" >>"$FORMAT_TEST_RUST_LOG"
"$FORMAT_TEST_REAL_RUSTFMT" --edition 2024 --config skip_children=true -- "$@"
EOF
cat >"$fixture_root/nook-app/nook-web/nook-web-app/node_modules/.bin/prettier" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
test -f "$FORMAT_TEST_READY"
record=false
for argument in "$@"; do
  if [[ "$record" == true ]]; then
    printf '%s\n' "$argument" >>"$FORMAT_TEST_LOG"
  elif [[ "$argument" == '--' ]]; then
    record=true
  fi
done
EOF
chmod +x \
  "$fixture_root/bin/bun" \
  "$fixture_root/bin/rustfmt" \
  "$fixture_root/bin/task" \
  "$fixture_root/nook-app/nook-web/nook-web-app/node_modules/.bin/prettier"
printf 'baseline\n' >"$fixture_root/.agents/skills/demo/src/changed.ts"
printf 'baseline\n' >"$fixture_root/.agents/skills/demo/src/untouched.ts"
printf '{}\n' >"$fixture_root/.agents/skills/.prettierrc"
printf '{}\n' >"$fixture_root/.github/formatting/prettier-web.json"
printf '{}\n' >"$fixture_root/.github/formatting/prettier-default.json"
printf '{}\n' >"$fixture_root/.github/formatting/prettier-shared-typescript.json"
printf '{}\n' >"$fixture_root/agentic-ai/loom/.prettierrc"
printf '{}\n' >"$fixture_root/agentic-ai/minds/hive-console/.prettierrc"
printf '{}\n' >"$fixture_root/nook-app/nook-web/nook-web-app/.prettierrc"
printf '{}\n' >"$fixture_root/nook-app/nook-web/nook-web-extension/.prettierrc"
printf '{}\n' >"$fixture_root/nook-app/nook-web/nook-web-research/.prettierrc"
printf 'baseline\n' >"$fixture_root/agentic-ai/loom/src/loom.ts"
printf 'baseline\n' >"$fixture_root/agentic-ai/minds/hive-console/src/hive-console.ts"
printf 'fn mind() {}\n' >"$fixture_root/agentic-ai/minds/hive/src/mind.rs"
printf 'mod child; fn platform() {}\n' >"$fixture_root/nook-app/nook-platform/src/platform.rs"
printf 'pub fn untouched( ){println!("untouched");}\n' >"$fixture_root/nook-app/nook-platform/src/child.rs"
printf 'baseline\n' >"$fixture_root/preflight/src/preflight.rs"
printf 'baseline\n' >"$fixture_root/nook-app/nook-web/nook-web-app/src/web-app.ts"
printf 'baseline\n' >"$fixture_root/nook-app/nook-web/nook-web-extension/src/extension.ts"
printf 'baseline\n' >"$fixture_root/nook-app/nook-web/nook-web-research/src/research.ts"
printf 'baseline\n' >"$fixture_root/nook-app/nook-web/nook-web-shared/src/vault-app/shared.ts"
printf 'baseline\n' >"$fixture_root/nook-app/nook-web/nook-vault-simple/src/simple.svelte"
printf 'baseline\n' >"$fixture_root/nook-app/nook-web/nook-vault-sentinel/src/sentinel.svelte"
printf 'baseline\n' >"$fixture_root/README.md"
printf 'baseline\n' >"$fixture_root/tooling/eslint-rules/no-raw-object-arguments.js"
(
  cd "$fixture_root"
  git init -q
  git config user.email formatter-contract@example.invalid
  git config user.name formatter-contract
  git add -A
  git commit -qm baseline
  git update-ref refs/remotes/origin/main HEAD
  printf 'dirty\n' >.agents/skills/demo/src/changed.ts
  printf 'staged\n' >.agents/skills/demo/src/staged.ts
  git add .agents/skills/demo/src/staged.ts
  printf 'export default {};\n' >.agents/skills/eslint.config.js
  printf 'unrelated\n' >README.md
  printf 'const changed = true;\n' >tooling/eslint-rules/no-raw-object-arguments.js
  printf 'const loom = true;\n' >agentic-ai/loom/src/loom.ts
  printf 'const hiveConsole = true;\n' >agentic-ai/minds/hive-console/src/hive-console.ts
  printf 'fn mind( ) {}\n' >agentic-ai/minds/hive/src/mind.rs
  printf 'mod child; fn platform( ) {}\n' >nook-app/nook-platform/src/platform.rs
  printf 'fn preflight() {}\n' >preflight/src/preflight.rs
  printf 'const webApp = true;\n' >nook-app/nook-web/nook-web-app/src/web-app.ts
  printf 'const extension = true;\n' >nook-app/nook-web/nook-web-extension/src/extension.ts
  printf 'const research = true;\n' >nook-app/nook-web/nook-web-research/src/research.ts
  printf 'const shared = true;\n' >nook-app/nook-web/nook-web-shared/src/vault-app/shared.ts
  printf '<p>simple</p>\n' >nook-app/nook-web/nook-vault-simple/src/simple.svelte
  printf '<p>sentinel</p>\n' >nook-app/nook-web/nook-vault-sentinel/src/sentinel.svelte
  FORMAT_TEST_LOG="$fixture_root/format.log" \
  FORMAT_TEST_INSTALL_LOG="$fixture_root/install.log" \
  FORMAT_TEST_RUST_LOG="$fixture_root/rust.log" \
  FORMAT_TEST_REAL_RUSTFMT="$(command -v rustfmt)" \
  FORMAT_TEST_READY="$fixture_root/prettier.ready" \
  FORMAT_TEST_REAL_TASK="$(command -v task)" \
  HIVE_SEALED_GUEST=1 \
  PATH="$fixture_root/bin:$PATH" \
    bash .github/scripts/format-host-apply.sh >/dev/null
  test "$(git hash-object nook-app/nook-platform/src/child.rs)" = "$(git rev-parse HEAD:nook-app/nook-platform/src/child.rs)"
)
printf '%s\n' 'install --frozen-lockfile' >"$fixture_root/expected-install.log"
cmp -s "$fixture_root/expected-install.log" "$fixture_root/install.log" \
  || { echo 'format-host-apply test: sealed guest did not frozen-install pinned Prettier' >&2; exit 1; }
printf '%s\n' \
  '../nook-vault-sentinel/src/sentinel.svelte' \
  '../nook-vault-simple/src/simple.svelte' \
  '../nook-web-shared/src/vault-app/shared.ts' \
  'demo/src/changed.ts' \
  'demo/src/staged.ts' \
  'eslint.config.js' \
  'src/extension.ts' \
  'src/hive-console.ts' \
  'src/loom.ts' \
  'src/research.ts' \
  'src/web-app.ts' \
  'tooling/eslint-rules/no-raw-object-arguments.js' \
  | sort >"$fixture_root/expected.log"
sort "$fixture_root/format.log" >"$fixture_root/actual.log"
cmp -s "$fixture_root/expected.log" "$fixture_root/actual.log" \
  || { echo 'format-host-apply test: sealed guest changed-path selection drifted' >&2; exit 1; }
printf '%s\n' \
  'agentic-ai/minds/hive/src/mind.rs' \
  'nook-app/nook-platform/src/platform.rs' \
  'preflight/src/preflight.rs' \
  | sort >"$fixture_root/expected-rust.log"
sort "$fixture_root/rust.log" >"$fixture_root/actual-rust.log"
cmp -s "$fixture_root/expected-rust.log" "$fixture_root/actual-rust.log" \
  || { echo 'format-host-apply test: sealed guest Rust changed-path selection drifted' >&2; exit 1; }
if grep -Fq 'untouched.ts' "$fixture_root/format.log"; then
  echo 'format-host-apply test: sealed guest formatted an untouched skill file' >&2
  exit 1
fi
(
  cd "$fixture_root"
  rm -f format.log expected.log actual.log rust.log expected-rust.log actual-rust.log install.log expected-install.log prettier.ready
  git add -A
  git commit -qm formatted-state
  git update-ref refs/remotes/origin/main HEAD
  FORMAT_TEST_LOG="$fixture_root/format.log" \
  FORMAT_TEST_INSTALL_LOG="$fixture_root/install.log" \
  FORMAT_TEST_RUST_LOG="$fixture_root/rust.log" \
  FORMAT_TEST_REAL_RUSTFMT="$(command -v rustfmt)" \
  FORMAT_TEST_READY="$fixture_root/prettier.ready" \
  FORMAT_TEST_REAL_TASK="$(command -v task)" \
  HIVE_SEALED_GUEST=1 \
  PATH="$fixture_root/bin:$PATH" \
    bash .github/scripts/format-host-apply.sh >/dev/null
)
test ! -e "$fixture_root/format.log" \
  || { echo 'format-host-apply test: sealed guest no-op invoked Prettier' >&2; exit 1; }
test ! -e "$fixture_root/rust.log" \
  || { echo 'format-host-apply test: sealed guest no-op invoked rustfmt' >&2; exit 1; }

echo 'format-host-apply test: ok'
