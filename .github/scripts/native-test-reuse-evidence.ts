import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { CacheTelemetry } from "../workflows/lib/cache-telemetry.mjs";

enum NativeStepState {
  Cached = "CACHED",
  Executed = "DONE",
  Failed = "ERROR",
}

enum NativeStage {
  Common = "builder-native-common-test",
  Authenticator = "builder-native-authenticator-test",
  Replication = "builder-native-replication-test",
  Auth2 = "builder-native-auth2-test",
  EventLog = "builder-native-event-log-test",
  Companion = "builder-native-companion-test",
  Core = "builder-native-core-test",
  Coverage = "builder-debug",
}

enum NativeProofCase {
  Cold = "cold",
  Warm = "warm",
  Documentation = "documentation",
  Replication = "replication",
  FloorFailure = "floor-failure",
  TestFailure = "test-failure",
  RegistryExport = "registry-export",
  RegistryImport = "registry-import",
}

enum NativeTestPackage {
  Common = "nook-app-common",
  Authenticator = "nook-authenticator-domain",
  Replication = "nook-replication",
  Auth2 = "nook-auth2",
  EventLog = "nook-event-log",
  Companion = "nook-companion-core",
  Core = "nook-core",
}

enum EvidenceOperation { Verify = "verify", Report = "report" }
enum CacheAuthority { BuildKit = "BuildKit" }
enum CacheStore { PersistentWorker = "existing_persistent_worker" }
enum StorePortability { NotDemonstrated = "not_independently_demonstrated" }
enum ColdScope { NativeTests = "native_test_result_stages_with_reusable_toolchain_and_dependencies" }

type NativeSccacheSummary = ReturnType<typeof CacheTelemetry.summarizeSccache>;

interface NativeLeaf {
  readonly stage: NativeStage;
  readonly package: NativeTestPackage;
}

interface NativeStep {
  readonly stage: NativeStage;
  readonly vertex: string;
  readonly state: NativeStepState;
}

interface ArtifactMeasurementRequest {
  readonly name: NativeProofCase;
  readonly leaf: NativeLeaf;
}

interface MeasuredFloorFailure {
  readonly exit_status: number;
  readonly measured_core_lines_percent: number;
  readonly required_core_lines_percent: number;
  readonly tests: readonly NativeStep[];
}

interface NativeProofCases {
  readonly cold: readonly NativeStep[];
  readonly warm: readonly NativeStep[];
  readonly documentation: readonly NativeStep[];
  readonly replication: readonly NativeStep[];
  readonly floor_failure: MeasuredFloorFailure;
  readonly actual_test_failure: NativeStep;
  readonly cold_sccache: NativeSccacheSummary;
  readonly changed_source_sccache: NativeSccacheSummary;
  readonly measured_llvm_artifacts: readonly NativeArtifactMeasurement[];
}

interface NativeArtifactMeasurement {
  readonly package: NativeTestPackage;
  readonly profiles: number;
  readonly objects: number;
  readonly bytes: number;
}

interface RegistryCacheEvidence {
  readonly reference: string;
  readonly exported: readonly NativeStep[];
  readonly imported: readonly NativeStep[];
  readonly manifest_bytes: number;
}

interface NativeProofReport {
  readonly source_sha: string;
  readonly cache_authority: CacheAuthority;
  readonly cache_store: CacheStore;
  readonly cold_scope: ColdScope;
  readonly fresh_store_portability: StorePortability;
  readonly registry_cache: RegistryCacheEvidence;
  readonly cases: NativeProofCases;
}

/** Observes actual BuildKit output; it never computes a cache key or selects reuse. */
class NativeBuildLog {
  private readonly text: string;

  constructor(private readonly directory: string) {
    this.text = stripVTControlCharacters(
      readFileSync(join(directory, "build.log"), "utf8"),
    );
  }

  step(stage: NativeStage): NativeStep {
    const headers = this.text.matchAll(
      new RegExp(`^(#[0-9]+) \\[[^\\]]*\\b${stage}\\s+[0-9]+/[0-9]+\\] RUN\\b`, "gm"),
    );
    const vertices = new Set(
      Array.from(headers).flatMap((match) => match.slice(1, 2)),
    );
    assert.equal(vertices.size, 1, `expected one actual RUN for ${stage}`);
    for (const vertex of vertices) {
      return { stage, vertex, state: this.terminal(vertex) };
    }
    throw new Error(`actual BuildKit vertex missing for ${stage}`);
  }

  private terminal(vertex: string): NativeStepState {
    const terminals = this.text.matchAll(
      new RegExp(`^${vertex} (CACHED|DONE|ERROR)\\b`, "gm"),
    );
    for (const token of Array.from(terminals).flatMap((match) => match.slice(1, 2))) {
      const states = Object.values(NativeStepState).filter((state) => String(state) === token);
      for (const state of states) return state;
    }
    throw new Error(`actual terminal BuildKit status missing for ${vertex}`);
  }

  exitStatus(): number {
    const status = Number(readFileSync(join(this.directory, "exit-status"), "utf8").trim());
    assert(Number.isSafeInteger(status) && status >= 0, "invalid actual build exit status");
    return status;
  }

  assertActualTestFailure(): NativeStep {
    assert.notEqual(this.exitStatus(), 0);
    assert.match(
      this.text,
      /(?:FAIL|FAILED)[^\n]*native_test_reuse_expected_failure|native_test_reuse_expected_failure[^\n]*(?:FAIL|FAILED)/,
      "the negative case must fail an executed Rust test, not compilation or Clippy",
    );
    const step = this.step(NativeStage.Replication);
    assert.equal(step.state, NativeStepState.Failed);
    return step;
  }

  measuredFloorFailure(tests: readonly NativeStep[]): MeasuredFloorFailure {
    assert.notEqual(this.exitStatus(), 0);
    assert.equal(this.step(NativeStage.Coverage).state, NativeStepState.Failed);
    // Read the actual final LLVM package table; do not combine percentages.
    const totals = Array.from(this.text.matchAll(/^#[0-9]+\s+[0-9.]+\s+TOTAL\b[^\n]*/gm));
    assert.equal(totals.length, 7, "all seven actual package floor reports must complete");
    for (const row of totals.slice(-1)) {
      const percentages = Array.from(row.join("").matchAll(/[0-9]+(?:\.[0-9]+)?%/g));
      for (const percentage of percentages.slice(2, 3)) {
        const measured = Number(percentage.join("").replace("%", ""));
        assert(Number.isFinite(measured) && measured < 100);
        return { exit_status: this.exitStatus(), measured_core_lines_percent: measured,
          required_core_lines_percent: 100, tests };
      }
    }
    throw new Error("actual LLVM core line-coverage rejection was not observed");
  }

  assertContains(text: string): void {
    assert(this.text.includes(text), `actual BuildKit log missing: ${text}`);
  }

  sccache(): NativeSccacheSummary {
    const reports = CacheTelemetry.extractSccacheReportsFromText(this.text);
    assert(reports.length > 0, "executed native stages must retain actual sccache statistics");
    const summary = CacheTelemetry.summarizeSccache(reports);
    assert.equal(summary.runtime_mode, "READ_WRITE");
    assert.equal(summary.cache_errors, 0);
    assert.equal(summary.cache_write_errors, 0);
    assert.equal(summary.compile_failures, 0);
    assert(summary.cache_hits > 0 || summary.remote_writes > 0);
    assert.equal(CacheTelemetry.extractSccacheFallbackFromText(this.text).state, "active");
    return summary;
  }
}

/** Checks real solves and retained artifacts after the Task has executed them. */
class NativeTestReuseEvidence {
  private readonly leaves: readonly NativeLeaf[] = [
    { stage: NativeStage.Common, package: NativeTestPackage.Common },
    { stage: NativeStage.Authenticator, package: NativeTestPackage.Authenticator },
    { stage: NativeStage.Replication, package: NativeTestPackage.Replication },
    { stage: NativeStage.Auth2, package: NativeTestPackage.Auth2 },
    { stage: NativeStage.EventLog, package: NativeTestPackage.EventLog },
    { stage: NativeStage.Companion, package: NativeTestPackage.Companion },
    { stage: NativeStage.Core, package: NativeTestPackage.Core },
  ];

  constructor(private readonly directory: string) {}

  private successfulCase(name: NativeProofCase): NativeStep[] {
    const log = new NativeBuildLog(join(this.directory, name));
    assert.equal(log.exitStatus(), 0, `${name} must be an actual successful solve`);
    assert(statSync(join(this.directory, name, "build-metadata.json")).size > 0);
    assert(statSync(join(this.directory, name, "result/coverage/nook-core/summary.json")).size > 0);
    return this.leaves.map((leaf) => log.step(leaf.stage));
  }

  private assertCached(steps: readonly NativeStep[]): void {
    for (const step of steps) assert.equal(step.state, NativeStepState.Cached, step.stage);
  }

  private artifacts(name: NativeProofCase): NativeArtifactMeasurement[] {
    return this.leaves.map((leaf) => this.measureArtifact({ name, leaf }));
  }

  private measureArtifact(request: ArtifactMeasurementRequest): NativeArtifactMeasurement {
    const directory = join(this.directory, request.name, "result/native-tests", request.leaf.package);
    const junit = readFileSync(join(directory, "junit.xml"), "utf8");
    assert.match(junit, /<testsuites\b[^>]*\btests="[1-9][0-9]*"/);
    assert.match(junit, /<testsuites\b[^>]*\bfailures="0"/);
    assert.match(junit, /<testsuites\b[^>]*\berrors="0"/);
    const files = readFileSync(join(directory, "artifact-files.tsv"), "utf8")
      .trim().split("\n");
    const profiles = files.filter((line) => line.includes("/profiles/")).length;
    const objects = files.filter((line) => line.includes("/objects/")).length;
    assert(profiles > 0 && objects > 0, `missing real LLVM inputs for ${request.leaf.package}`);
    let bytes = 0;
    for (const line of files) {
      const sizes = line.split("\t").slice(1, 2);
      assert.equal(sizes.length, 1, "invalid actual artifact measurement");
      for (const size of sizes) {
        const measured = Number(size);
        assert(Number.isSafeInteger(measured) && measured > 0);
        bytes += measured;
      }
    }
    return { package: request.leaf.package, profiles, objects, bytes };
  }

  verifyCases(): NativeProofCases {
    const cold = this.successfulCase(NativeProofCase.Cold);
    for (const step of cold) assert.equal(step.state, NativeStepState.Executed, step.stage);
    const coldSccache = new NativeBuildLog(join(this.directory, NativeProofCase.Cold)).sccache();
    const warm = this.successfulCase(NativeProofCase.Warm);
    this.assertCached(warm);
    const documentation = this.successfulCase(NativeProofCase.Documentation);
    this.assertCached(documentation);
    const replication = this.successfulCase(NativeProofCase.Replication);
    for (const step of replication) {
      switch (step.stage) {
        case NativeStage.Common:
        case NativeStage.Authenticator:
        case NativeStage.Auth2:
          assert.equal(step.state, NativeStepState.Cached, step.stage);
          break;
        case NativeStage.Replication:
        case NativeStage.EventLog:
        case NativeStage.Companion:
        case NativeStage.Core:
          assert.equal(step.state, NativeStepState.Executed, step.stage);
          break;
        case NativeStage.Coverage:
          throw new Error(`unexpected real native stage: ${step.stage}`);
      }
    }
    const changedSccache = new NativeBuildLog(join(this.directory, NativeProofCase.Replication)).sccache();
    assert(changedSccache.cache_hits > 0, "changed-source zero-hit compiler reuse is terminal");
    const floor = new NativeBuildLog(join(this.directory, NativeProofCase.FloorFailure));
    const floorTests = this.leaves.map((leaf) => floor.step(leaf.stage));
    this.assertCached(floorTests);
    const floorFailure = floor.measuredFloorFailure(floorTests);
    const testFailure = new NativeBuildLog(join(this.directory, NativeProofCase.TestFailure)).assertActualTestFailure();
    return {
      cold, warm, documentation, replication,
      floor_failure: floorFailure,
      actual_test_failure: testFailure,
      cold_sccache: coldSccache,
      changed_source_sccache: changedSccache,
      measured_llvm_artifacts: this.artifacts(NativeProofCase.Warm),
    };
  }

  report(): void {
    const cases = this.verifyCases();
    const exported = this.successfulCase(NativeProofCase.RegistryExport);
    const imported = this.successfulCase(NativeProofCase.RegistryImport);
    this.assertCached(exported);
    this.assertCached(imported);
    const reference = readFileSync(join(this.directory, "cache-ref"), "utf8").trim();
    new NativeBuildLog(join(this.directory, NativeProofCase.RegistryExport)).assertContains("exporting cache to registry");
    new NativeBuildLog(join(this.directory, NativeProofCase.RegistryImport)).assertContains(`importing cache manifest from ${reference}`);
    const manifestText = readFileSync(join(this.directory, "cache-manifest.json"), "utf8");
    const manifest: unknown = JSON.parse(manifestText);
    assert(manifest && typeof manifest === "object" && "schemaVersion" in manifest);
    assert.equal(manifest.schemaVersion, 2);
    const report: NativeProofReport = {
      source_sha: readFileSync(join(this.directory, "source-sha"), "utf8").trim(),
      cache_authority: CacheAuthority.BuildKit,
      cache_store: CacheStore.PersistentWorker,
      cold_scope: ColdScope.NativeTests,
      fresh_store_portability: StorePortability.NotDemonstrated,
      registry_cache: { reference, exported, imported, manifest_bytes: Buffer.byteLength(manifestText) },
      cases,
    };
    writeFileSync(join(this.directory, "evidence.json"), JSON.stringify(report) + "\n");
  }

  static main(): void {
    assert.equal(process.argv.length, 4, "expected evidence directory and verify/report operation");
    const directory = process.argv.slice(2, 3).join("");
    const rawOperation = process.argv.slice(3, 4).join("");
    const operations = Object.values(EvidenceOperation).filter((operation) => String(operation) === rawOperation);
    assert.equal(operations.length, 1, `unknown evidence operation: ${rawOperation}`);
    const evidence = new NativeTestReuseEvidence(directory);
    for (const operation of operations) {
      switch (operation) {
        case EvidenceOperation.Verify: evidence.verifyCases(); break;
        case EvidenceOperation.Report: evidence.report(); break;
      }
    }
  }
}

NativeTestReuseEvidence.main();
