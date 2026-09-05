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
docker_setup_selection = docker_setup_action.dig("inputs", "cache-selection")
docker_setup_cache_script = docker_setup_action.fetch("runs").fetch("steps").find do |step|
  step["name"] == "Select hosted BuildKit cache"
end&.fetch("run", "")
unless docker_setup_selection&.fetch("default") == "general" &&
       docker_setup_cache_script.include?("general|hive|connection-only") &&
       docker_setup_cache_script.include?("cache-selection must be general, hive, or connection-only") &&
       docker_setup_cache_script.include?('if [ "$cache_selection" = "general" ]; then') &&
       docker_setup_cache_script.match?(
         /case "\$cache_selection" in\s+general\|hive\)\s+hive_remote_ref=.*?\s+;;\s+esac/m
       )
  raise "Docker setup cache selection must be closed, validated, and general by default"
end

general_probe_start = docker_setup_cache_script.index(
  'if [ "$cache_selection" = "general" ]; then'
)
general_probe_end = docker_setup_cache_script.index(
  'echo "GHA_CACHE_EXACT_PROBES_COMPLETE=1"',
  general_probe_start
)
hive_probe_start = docker_setup_cache_script.index('if [ -n "$hive_remote_ref" ]; then')
irrelevant_hive_probes = [
  "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_DYLINT_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_FUZZ_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_POLICY_TOOLS_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_DETERMINISTIC_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_KANI_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE",
  "GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE",
  "GHA_CACHE_MAIN_RUST_WASM_SOURCE_AVAILABLE",
  "GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE",
  "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE",
  "GHA_CACHE_EXACT_WEB_E2E_AVAILABLE"
]
unless general_probe_start && general_probe_end && hive_probe_start &&
       general_probe_end < hive_probe_start &&
       irrelevant_hive_probes.all? do |probe|
         probe_index = docker_setup_cache_script.index(probe)
         probe_index && general_probe_start < probe_index && probe_index < general_probe_end
       end
  raise "Hive cache selection must not issue general Rust, WASM, preflight, or web probes"
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
