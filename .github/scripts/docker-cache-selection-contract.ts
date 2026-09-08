import { resolve } from "node:path";

import { TextContract } from "./text-contract";

enum DockerCacheSelection {
  ConnectionOnly = "connection-only",
  General = "general",
  Hive = "hive",
  Native = "native",
  Preflight = "preflight",
  Wasm = "wasm",
  WasmProof = "wasm-proof",
  WebE2e = "web-e2e",
}

interface DockerCacheSelectionAction {
  inputs: Record<string, { default: string }>;
  runs: { steps: Array<{ name: string; run: string }> };
}

export class DockerCacheSelectionContract {
  static async assert(root: string): Promise<void> {
    const action = Bun.YAML.parse(
      await Bun.file(
        resolve(root, ".github/actions/nook-docker-setup/action.yml"),
      ).text(),
    ) as DockerCacheSelectionAction;
    const selection = action.inputs["cache-selection"];
    if (selection.default !== DockerCacheSelection.General) {
      throw new Error("Docker cache selection must default to general");
    }
    const script = action.runs.steps.find(
      (step) => step.name === "Select hosted BuildKit cache",
    );
    if (!script) throw new Error("Docker cache selection step is missing");
    DockerCacheSelectionContract.assertClosedSet(script.run);
    DockerCacheSelectionContract.assertHiveProfile(script.run);
  }

  private static assertClosedSet(source: string): void {
    const values = Object.values(DockerCacheSelection);
    const contract = new TextContract({
      label: "Docker cache selection",
      source,
    });
    contract.requireAll([
      `general|native|wasm|wasm-proof|preflight|web-e2e|hive|connection-only) ;;`,
      "cache-selection must be general, native, wasm, wasm-proof, preflight, web-e2e, hive, or connection-only",
    ]);
    const start = source.indexOf(
      'cache_selection="${{ inputs.cache-selection }}"',
    );
    const end = source.indexOf('test -n "$NOOK_SELECTED_BUILDER"', start);
    if (start < 0 || end < 0)
      throw new Error("cache selection validation is missing");
    const validation = source.slice(start, end);
    for (const value of [...values, "unknown-cache-selection"]) {
      const probe = validation.replace(
        'cache_selection="${{ inputs.cache-selection }}"',
        `cache_selection=${value}`,
      );
      const result = Bun.spawnSync({
        cmd: ["bash"],
        stdin: new Blob([probe]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const accepted = result.exitCode === 0;
      if (accepted !== values.includes(value as DockerCacheSelection)) {
        throw new Error(
          `Docker cache selection validation failed for ${value}`,
        );
      }
    }
  }

  private static assertHiveProfile(source: string): void {
    const profileEnd = source.indexOf(
      'echo "GHA_CACHE_EXACT_PROBES_COMPLETE=1"',
    );
    const hiveStart = source.indexOf('if [ -n "$hive_remote_ref" ]; then');
    if (profileEnd < 0 || hiveStart < profileEnd) {
      throw new Error("Hive probe must follow bounded profile probes");
    }
    const profile = new TextContract({
      label: "Docker non-Hive cache profiles",
      source: source.slice(0, profileEnd),
    });
    profile.requireAll([
      "general|native|wasm|wasm-proof)",
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "native" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "wasm" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "preflight" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "web-e2e" ]; then',
      "general|native|wasm|preflight|web-e2e)",
    ]);
    const hive = source.slice(hiveStart);
    for (const probe of [
      "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE",
      "GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE",
      "GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE",
      "GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE",
      "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE",
      "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE",
      "GHA_CACHE_EXACT_WEB_E2E_AVAILABLE",
    ]) {
      if (hive.includes(probe)) {
        throw new Error(`Hive cache profile consumes unrelated probe ${probe}`);
      }
    }
  }
}
