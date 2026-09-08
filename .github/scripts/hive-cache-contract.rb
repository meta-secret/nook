#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

root = File.expand_path("../..", __dir__)
load_yaml = lambda do |path|
  YAML.safe_load(File.read(File.join(root, path)), aliases: true)
end

hive_dockerfile = File.read(File.join(root, "agentic-ai/minds/hive/Dockerfile"))
hive_taskfile = File.read(File.join(root, "agentic-ai/minds/hive/Taskfile.yml"))
hive_workflow = File.read(File.join(root, ".github/workflows/hive.yml"))
hive_cache_simulation = File.read(File.join(root, "infra/sim/bake-cache/hive.Dockerfile"))
hive_cache_bake = File.read(File.join(root, "infra/sim/bake-cache/docker-bake.hcl"))

unless hive_dockerfile.include?("FROM bun AS console-verification") &&
       hive_dockerfile.include?("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium") &&
       hive_taskfile.include?("--target console-verification") &&
       hive_taskfile.include?('HIVE_CONSOLE_CACHE_EXACT_FROM') &&
       hive_taskfile.include?('HIVE_CONSOLE_CACHE_TO')
  raise "Hive console verification must own a narrow cached browser image lineage"
end

console_image_task = hive_taskfile.match(
  /^  console:image:\n(?<body>.*?)(?=^  image:)/m
)&.[](:body)
unless console_image_task&.include?('probe_output="$(mktemp)"') &&
       console_image_task.include?('2>"$probe_output"') &&
       console_image_task.include?("grep -Eqi 'not found|manifest unknown|name unknown'") &&
       console_image_task.include?('cat "$probe_output" >&2') &&
       console_image_task.scan('rm -f "$probe_output"').length == 3 &&
       console_image_task.include?('return 2') &&
       console_image_task.include?('probe_status=$?') &&
       console_image_task.include?('exit "$probe_status"') &&
       !console_image_task.include?('imagetools inspect "$exact_ref" >/dev/null 2>&1')
  raise "Hive console exact-cache probe must distinguish absence from registry failure"
end

docker_setup_action = load_yaml.call(".github/actions/nook-docker-setup/action.yml")
docker_setup_cache_script = docker_setup_action.fetch("runs").fetch("steps").find do |step|
  step["name"] == "Select hosted BuildKit cache"
end&.fetch("run", "")

rust_bake = File.read(File.join(root, "nook-app/nook-platform/docker/rust/docker-bake.hcl"))
wasm_bake = File.read(File.join(root, "nook-app/nook-platform/nook-wasm/docker-bake.hcl"))
core_bake = File.read(File.join(root, "nook-app/nook-platform/nook-core/docker-bake.hcl"))
rust_deps_restore = rust_bake.match(
  /rust_deps_cache_from = (?<body>.*?)\n\nrust_deps_cache_to/m
)&.[](:body)
unless rust_deps_restore&.include?("GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE") &&
       rust_deps_restore.include?("nook-rust-native-source-v4:buildcache") &&
       !rust_deps_restore.include?("nook/buildcache/nook-rust-deps-v4:buildcache")
  raise "Native dependency restores must follow the one fresh Main source graph"
end
deterministic_restore = rust_bake.match(
  /rust_ecosystem_deterministic_cache_from = (?<body>.*?)\n\nrust_ecosystem_deterministic_cache_to/m
)&.[](:body)
unless deterministic_restore&.include?("nook-rust-native-source-v4:buildcache") &&
       !deterministic_restore.include?("nook/buildcache/nook-rust-deps-v4:buildcache")
  raise "Native ecosystem restores must not consume the stale Main dependency ref"
end
rust_product = File.read(File.join(root, "nook-app/nook-platform/docker/rust/product.Dockerfile"))
node_deps_start = rust_product.index("FROM wasm-coverage-toolchain AS builder-wasm-node-deps")
node_source_join = rust_product.index("FROM builder-wasm-node-deps AS builder-wasm-handoff")
node_coverage_execution = rust_product.index("nook-sccache-report wasm-node-test-and-coverage")
node_coverage_clean = rust_product.index('llvm-cov clean --workspace', node_deps_start)
node_coverage_environment = rust_product.index('llvm-cov show-env --sh)', node_deps_start)
node_browser_coverage_environment = rust_product.index(
  'llvm-cov show-env --sh --target wasm32-unknown-unknown',
  node_deps_start
)
node_coverage_prewarm = rust_product.index(
  'test --release -p nook-wasm --no-run',
  node_deps_start
)
node_browser_coverage_prewarm = rust_product.index(
  'test --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --no-run',
  node_deps_start
)
unless !docker_setup_cache_script.include?("GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE") &&
       !rust_bake.include?("nook-rust-wasm-node-v2") &&
       !wasm_bake.include?("rust_wasm_node_cache_") &&
       wasm_bake.include?("cache-from = rust_wasm_deps_cache_from") &&
       core_bake.match?(/target "builder-wasm-deps-cache-proof".*?target\s+= "builder-wasm-node-deps"/m) &&
       node_deps_start && node_source_join && node_coverage_execution &&
       rust_product.index("apt-get install -y --no-install-recommends clang unzip", node_deps_start) < node_source_join &&
       rust_product.index("bunx playwright@${PLAYWRIGHT_VERSION} install-deps chromium", node_deps_start) < node_source_join &&
       node_coverage_clean && node_coverage_environment && node_browser_coverage_environment &&
       node_coverage_prewarm && node_browser_coverage_prewarm &&
       node_coverage_clean < node_coverage_environment && node_coverage_environment < node_coverage_prewarm &&
       node_coverage_prewarm < node_browser_coverage_environment &&
       node_browser_coverage_environment < node_browser_coverage_prewarm &&
       node_browser_coverage_prewarm < node_source_join &&
       rust_product[node_deps_start...node_source_join].include?("--no-run\nRUN eval") &&
       rust_product[node_deps_start...node_source_join].scan("CARGO_TARGET_DIR=target/llvm-cov-target").length == 4 &&
       !rust_product[node_deps_start...node_source_join].include?("RUSTC_WRAPPER=") &&
       !rust_product[node_deps_start...node_source_join].include?("llvm-cov test") &&
       !rust_product[node_deps_start...node_source_join].include?("llvm-cov --no-run") &&
       !rust_product[node_source_join...node_coverage_execution].include?("--no-clean --release -p nook-wasm --no-report") &&
       node_source_join < node_coverage_execution
  raise "WASM Node must reuse source-free dependency caches, never a terminal source cache"
end

unless hive_workflow.include?("run: task hive:console:image") &&
       hive_workflow.include?("nook-hive-console-v1-git-") &&
       hive_workflow.include?("nook/buildcache/nook-hive-console-v1:buildcache") &&
       !hive_workflow.include?("task web:e2e:kubernetes-image")
  raise "Hive console CI must not solve the Nook Web Rust/WASM browser graph"
end

console_image_job = load_yaml.call(".github/workflows/hive.yml")
  .fetch("jobs")
  .fetch("console-image")
console_registry_setup = console_image_job.fetch("steps").find do |step|
  step["uses"] == "./.github/actions/nook-docker-setup"
end
verify_registry_setup = load_yaml.call(".github/workflows/hive.yml")
  .fetch("jobs")
  .fetch("verify")
  .fetch("steps")
  .find { |step| step["uses"] == "./.github/actions/nook-docker-setup" }
trusted_main = "github.event_name == 'push' && github.ref == 'refs/heads/main'"
unless console_registry_setup&.dig("with", "cache-selection") == "connection-only" &&
       verify_registry_setup&.dig("with", "cache-selection") == "hive" &&
       console_registry_setup&.dig("with", "registry-username") ==
       "${{ #{trusted_main} && secrets.NOOK_REGISTRY_USERNAME || secrets.NOOK_REGISTRY_REMOTE_USERNAME }}" &&
       console_registry_setup&.dig("with", "registry-password") ==
       "${{ #{trusted_main} && secrets.NOOK_REGISTRY_PASSWORD || secrets.NOOK_REGISTRY_REMOTE_PASSWORD }}"
  raise "Hive jobs must select bounded probes and use trusted console writer credentials only on Main pushes"
end

unless hive_cache_simulation.include?("FROM console-browser AS console-dependencies") &&
       hive_cache_simulation.include?("FROM console-dependencies AS console-verify") &&
       hive_cache_simulation.index("bake-sim-hive-console-dependencies") <
         hive_cache_simulation.index("COPY inputs/leaf.txt /tmp/console-source") &&
       hive_cache_bake.include?('target "hive-console"') &&
       hive_cache_bake.include?("nook-bake-sim-hive-console-v1") &&
       hive_cache_bake.include?("HIVE_CONSOLE_EXACT_AVAILABLE")
  raise "Hive cache simulation must model source-free console dependencies and exact replay"
end
