import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import {
  OperationalContractSource,
  OperationalYamlDocument,
  OperationalShellProbe,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { resolve } from "node:path";

import { TextContract } from "./text-contract";

enum DockerCacheSelection {
  ConnectionOnly = "connection-only",
  EcosystemDeterministic = "ecosystem-deterministic",
  EcosystemDylint = "ecosystem-dylint",
  EcosystemFuzz = "ecosystem-fuzz",
  EcosystemKani = "ecosystem-kani",
  EcosystemPolicyTools = "ecosystem-policy-tools",
  General = "general",
  Hive = "hive",
  Native = "native",
  Preflight = "preflight",
  Wasm = "wasm",
  WasmProof = "wasm-proof",
  WebE2e = "web-e2e",
}

const cacheActionSchema = z.object({
  inputs: z.object({
    "cache-selection": z.object({ default: z.enum(DockerCacheSelection) }),
  }),
  runs: z.object({
    steps: z.array(
      z.union([
        z.object({ name: z.string(), run: z.string() }),
        z.object({ name: z.string(), uses: z.string() }),
      ]),
    ),
  }),
});
type DockerSetupActionRuns = z.infer<typeof cacheActionSchema>["runs"];
interface DockerSetupRunStep {
  name: string;
  run: string;
}

export class DockerCacheSelectionContract {
  constructor(private readonly root: string) {}
  async assert(): Promise<Result<void, OperationalContractFailure>> {
    const root = this.root;
    const source = await new OperationalContractSource(
      resolve(root, ".github/actions/nook-docker-setup/action.yml"),
    ).read();
    if (source.isErr()) return err(source.error);
    const decoded = new OperationalYamlDocument(source.value).decode(
      cacheActionSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const action = decoded.value;
    const selection = action.inputs["cache-selection"];
    if (selection.default !== DockerCacheSelection.General) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Docker cache selection must default to general",
      });
    }
    const script = this.selectionStep(action.runs);
    if (script.isErr()) return err(script.error);
    const closed = this.assertClosedSet(script.value.run);
    if (closed.isErr()) return err(closed.error);
    return this.assertHiveProfile(script.value.run);
  }

  private selectionStep(
    runs: DockerSetupActionRuns,
  ): Result<DockerSetupRunStep, OperationalContractFailure> {
    for (const step of runs.steps) {
      if (step.name === "Select hosted BuildKit cache" && "run" in step) {
        return ok(step);
      }
    }
    return err({
      kind: OperationalContractFailureKind.Requirement,
      message: "Docker cache selection step is missing",
    });
  }

  private assertClosedSet(
    source: string,
  ): Result<void, OperationalContractFailure> {
    const values = Object.values(DockerCacheSelection);
    const contract = new TextContract({
      label: "Docker cache selection",
      source,
    });
    const admitted = contract.requireAll([
      `general|native|wasm|wasm-proof|preflight|web-e2e|hive|connection-only|ecosystem-dylint|ecosystem-fuzz|ecosystem-policy-tools|ecosystem-deterministic|ecosystem-kani) ;;`,
      "cache-selection is outside the closed consumer profile set",
    ]);
    if (admitted.isErr()) return err(admitted.error);
    const start = source.indexOf(
      'cache_selection="${{ inputs.cache-selection }}"',
    );
    const end = source.indexOf('test -n "$NOOK_SELECTED_BUILDER"', start);
    if (start < 0 || end < 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "cache selection validation is missing",
      });
    const validation = source.slice(start, end);
    for (const value of [...values, "unknown-cache-selection"]) {
      const probe = validation.replace(
        'cache_selection="${{ inputs.cache-selection }}"',
        `cache_selection=${value}`,
      );
      const probed = new OperationalShellProbe(probe).execute();
      if (probed.isErr()) return err(probed.error);
      const result = probed.value;
      const accepted = result.exitCode === 0;
      if (accepted !== values.includes(value as DockerCacheSelection)) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `Docker cache selection validation failed for ${value}`,
        });
      }
    }
    return ok();
  }

  private assertHiveProfile(
    source: string,
  ): Result<void, OperationalContractFailure> {
    const profileEnd = source.indexOf(
      'echo "GHA_CACHE_EXACT_PROBES_COMPLETE=1"',
    );
    const hiveStart = source.indexOf('if [ -n "$hive_remote_ref" ]; then');
    if (profileEnd < 0 || hiveStart < profileEnd) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive probe must follow bounded profile probes",
      });
    }
    const profile = new TextContract({
      label: "Docker non-Hive cache profiles",
      source: source.slice(0, profileEnd),
    });
    const admitted = profile.requireAll([
      "general|native|wasm|wasm-proof)",
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "native" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "wasm" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "preflight" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "web-e2e" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-dylint" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-fuzz" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-policy-tools" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-deterministic" ]; then',
      'if [ "$cache_selection" = "general" ] || [ "$cache_selection" = "ecosystem-kani" ]; then',
      "general|native|wasm|preflight|web-e2e|ecosystem-dylint|ecosystem-fuzz|ecosystem-policy-tools|ecosystem-deterministic|ecosystem-kani)",
    ]);
    if (admitted.isErr()) return err(admitted.error);
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
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `Hive cache profile consumes unrelated probe ${probe}`,
        });
      }
    }
    return ok();
  }
}
