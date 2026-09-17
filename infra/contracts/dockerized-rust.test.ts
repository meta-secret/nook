import { test, expect } from "bun:test";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { DockerizedRustE2eContract } from "./dockerized-rust-e2e.fixture";
import { DockerizedRustToolingContract } from "./dockerized-rust-tooling.fixture";

const tasksSchema = z.object({
  tasks: z.object({
    "preflight:policy:run": z.object({ cmds: z.array(z.string()) }),
  }),
});

interface GitFixtureCommand {
  cwd: string;
  args: string[];
}

class DockerizedRustContract {
  private readonly root = resolve(import.meta.dir, "../..");

  previewGates(): void {
    const workflow = z
      .object({
        jobs: z.record(
          z.string(),
          z.object({
            needs: z.union([z.string(), z.array(z.string())]).optional(),
            if: z.string().optional(),
            steps: z
              .array(
                z.object({
                  run: z.string().optional(),
                  if: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      })
      .parse(Bun.YAML.parse(this.read(".github/workflows/pr.yml")));
    const preview = z
      .object({
        needs: z.array(z.string()),
        steps: z
          .tuple([z.object({ run: z.string() })])
          .rest(z.object({ run: z.string().optional() })),
      })
      .parse(workflow.jobs.preview);
    const script = preview.steps[0].run;
    expect(preview.needs).toContain("wasm-node-test");
    expect(preview.needs).toContain("extension-e2e");
    expect(Object.keys(workflow.jobs)).not.toContain(
      "auth-sensitive-extension-e2e",
    );
    expect(Object.keys(workflow.jobs)).not.toContain("full-extension-e2e");
    const extension = z
      .object({
        if: z.string(),
        steps: z.array(
          z.object({ if: z.string().optional(), run: z.string().optional() }),
        ),
      })
      .parse(workflow.jobs["extension-e2e"]);
    expect(extension.if).toContain("always()");
    expect(extension.if).toContain("needs.verify.result == 'success'");
    expect(extension.if).toContain(
      "inputs.full_e2e_requested || needs.verify.outputs.auth-sensitive-e2e-required == 'true'",
    );
    expect(extension.steps).toEqual([
      { if: "inputs.full_e2e_requested", run: "task _extension:test:e2e" },
      {
        if: "${{ !inputs.full_e2e_requested }}",
        run: "task _extension:test:e2e:file",
      },
    ]);
    for (const job of ["extension-e2e", "full-e2e-shard"]) {
      const dependent = z
        .object({ needs: z.array(z.string()) })
        .parse(workflow.jobs[job]);
      expect(dependent.needs).not.toContain("wasm-node-test");
      expect(dependent.needs).toContain("verify");
    }
    for (const full of ["true", "false"]) {
      for (const auth of ["true", "false"]) {
        for (const result of ["success", "failure", "cancelled", "skipped"]) {
          for (const node of ["success", "failure", "cancelled", "skipped"]) {
            const run = spawnSync("bash", ["-c", script], {
              encoding: "utf8",
              env: {
                ...process.env,
                NATIVE_RESULT: "success",
                WASM_RESULT: "success",
                WEB_RESULT: "success",
                WASM_NODE_RESULT: node,
                UI_DEMOS_ENABLED: "false",
                UI_DEMO_REQUIRED: "false",
                UI_DEMO_RESULT: "skipped",
                AUTH_SENSITIVE_E2E_REQUIRED: auth,
                FULL_E2E_REQUESTED: full,
                EXTENSION_E2E_RESULT: result,
              },
            });
            expect(run.status === 0, run.stdout).toBe(
              (result === "success" ||
                (full === "false" && auth === "false")) &&
                node === "success",
            );
          }
        }
      }
    }
  }

  ecosystemResults(): void {
    const tasks = z
      .object({
        tasks: z.object({
          "docker:ecosystem:smoke": z.object({ cmds: z.array(z.string()) }),
        }),
      })
      .parse(
        Bun.YAML.parse(this.read("nook-app/nook-platform/docker/Taskfile.yml")),
      );
    const script = z
      .string()
      .parse(tasks.tasks["docker:ecosystem:smoke"].cmds[0]);
    const temporary = mkdtempSync(join(tmpdir(), "nook-ecosystem-results-"));
    try {
      writeFileSync(
        join(temporary, "task"),
        '#!/bin/sh\ncase ",$FAILURES," in *",$1,"*) exit 1 ;; *) exit 0 ;; esac\n',
        { mode: 0o755 },
      );
      for (let failures = 0; failures < 8; failures += 1) {
        const selected = [];
        if (failures & 1) selected.push("docker:ecosystem:deterministic");
        if (failures & 2) selected.push("docker:ecosystem:fuzz");
        if (failures & 4) selected.push("docker:ecosystem:kani");
        const run = spawnSync("bash", ["-e", "-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${temporary}:${process.env.PATH}`,
            FAILURES: selected.join(","),
          },
        });
        expect(run.status === 0, run.stdout).toBe(failures === 0);
        expect(run.stdout).toContain("Deterministic tests");
        expect(run.stdout).toContain("Fuzz smoke");
        expect(run.stdout).toContain("Kani proofs");
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  coverageAndExporter(): void {
    const pr = this.read(".github/workflows/pr.yml");
    const checks = this.read(".github/workflows/rust-ecosystem-checks.yml");
    const product = this.read(
      "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    expect(pr).toContain("native_coverage_provided: true");
    expect(checks).toContain("type: boolean\n        default: false");
    expect(product).toContain("ARG NATIVE_COVERAGE_PROVIDED=false");
    expect(product).toContain(
      "true) INSTA_UPDATE=no cargo test --locked -p nook-replication --doc",
    );
    expect(product).toContain(
      "false) INSTA_UPDATE=no cargo test --locked -p nook-replication ;;",
    );
    expect(product).toContain(
      "INSTA_UPDATE=no cargo llvm-cov nextest --no-clean --profile ci -p nook-replication",
    );
    expect(product).toContain(
      "RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release",
    );
  }

  trustedRustConsumerUsesBuildKit(): void {
    const workflow = z
      .object({
        jobs: z.record(
          z.string(),
          z.object({
            steps: z
              .array(
                z.object({
                  if: z.string().optional(),
                  run: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      })
      .parse(Bun.YAML.parse(this.read(".github/workflows/pr.yml")));
    const rustJob = z
      .object({
        steps: z.array(
          z.object({
            if: z.string().optional(),
            run: z.string().optional(),
          }),
        ),
      })
      .parse(workflow.jobs.rust);
    const rustSteps = rustJob.steps;
    expect(
      rustSteps.filter(
        (step) =>
          typeof step.if === "string" &&
          step.if.includes("needs.rust-build.outputs.produced == 'true'") &&
          typeof step.run === "string" &&
          /\bdocker\s+(?:pull|run|create|start|exec)\b/.test(step.run),
      ),
    ).toEqual([]);
    const buildKitVerifySteps = z
      .array(
        z.object({
          if: z.literal("needs.rust-build.outputs.produced == 'true'"),
          run: z.string(),
        }),
      )
      .parse(
        rustSteps.filter(
          (step) =>
            step.if === "needs.rust-build.outputs.produced == 'true'" &&
            typeof step.run === "string",
        ),
      );
    expect(
      buildKitVerifySteps.some((step) =>
        step.run.includes("task docker:ci:rust:verify-built-buildkit"),
      ),
    ).toBe(true);

    const dockerTasks = this.read(
      "nook-app/nook-platform/docker/Taskfile.yml",
    );
    expect(dockerTasks).toMatch(
      /docker:ci:rust:verify-built-buildkit:[\s\S]*?buildx bake[\s\S]*?pr-native-verify/,
    );
    const bake = this.read(
      "nook-app/nook-platform/docker/rust/compile.docker-bake.hcl",
    );
    const dockerfile = this.read(
      "nook-app/nook-platform/docker/rust/compile.Dockerfile",
    );
    expect(bake).toContain('target "pr-native-verify"');
    expect(bake).toContain(
      'pr-native-image = "docker-image://${DOCKER_RUST_IMAGE}"',
    );
    const producerStart = dockerfile.indexOf(
      "FROM compile-native-source AS pr-native-build",
    );
    const verifyStart = dockerfile.indexOf(
      "FROM pr-native-image AS pr-native-verify",
    );
    expect(producerStart).toBeGreaterThanOrEqual(0);
    expect(verifyStart).toBeGreaterThan(producerStart);
    const producer = dockerfile.slice(producerStart, verifyStart);
    expect(producer).not.toContain("COPY . .");
    expect(producer).toContain("COPY nook-app nook-app");
  }

  dylintDependencyCacheAndSccacheMode(): void {
    const nightly = this.read(
      "nook-app/nook-platform/docker/rust/nightly.Dockerfile",
    );
    const product = this.read(
      "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    const wrapper = this.read(
      "nook-app/nook-platform/docker/sccache-wrapper.sh",
    );
    const dependencyStage = nightly.indexOf(
      "FROM rust-ecosystem-nightly AS rust-dylint-deps",
    );
    const dependencyBuild = nightly.indexOf(
      "cargo build --manifest-path dylint/nook-domain-api/Cargo.toml --locked",
      dependencyStage,
    );
    const sourceStage = nightly.indexOf(
      "FROM rust-dylint-deps AS rust-dylint-build",
    );
    const sourceCopy = nightly.indexOf(
      "COPY nook-app/nook-platform/dylint/nook-domain-api/ dylint/nook-domain-api/",
      sourceStage,
    );
    expect(dependencyStage).toBeGreaterThanOrEqual(0);
    expect(nightly).toContain(
      "COPY nook-app/nook-platform/dylint/nook-domain-api/Cargo.toml dylint/nook-domain-api/Cargo.toml",
    );
    expect(nightly).toContain(
      "COPY nook-app/nook-platform/dylint/nook-domain-api/Cargo.lock dylint/nook-domain-api/Cargo.lock",
    );
    expect(nightly).toContain("mkdir -p dylint/nook-domain-api/src");
    expect(dependencyBuild).toBeGreaterThan(dependencyStage);
    expect(sourceStage).toBeGreaterThan(dependencyBuild);
    expect(
      nightly.slice(dependencyStage, sourceStage),
    ).not.toContain(
      "COPY nook-app/nook-platform/dylint/nook-domain-api/ dylint/nook-domain-api/",
    );
    expect(sourceCopy).toBeGreaterThan(sourceStage);
    expect(product).toContain("ENV SCCACHE_CLIENT_SIDE=0");
    expect(product).not.toContain("ENV SCCACHE_CLIENT_SIDE=1");
    expect(wrapper).toContain(": \"${SCCACHE_CLIENT_SIDE:=0}\"");
    expect(wrapper).not.toContain("SCCACHE_CLIENT_SIDE:=1");
  }

  remoteCompileUsesTwoPhaseFoundation(): void {
    const bake = this.read(
      "nook-app/nook-platform/docker/rust/compile.docker-bake.hcl",
    );
    const dockerfile = this.read(
      "nook-app/nook-platform/docker/rust/compile.Dockerfile",
    );
    const script = this.read(".github/scripts/compile-remote.sh");
    const phaseA = script.indexOf(
      '"${bake_args[@]}" build-compile-foundation',
    );
    const phaseB = script.indexOf(
      '"${bake_args[@]}" build-compile',
      phaseA + 1,
    );
    expect(phaseA).toBeGreaterThanOrEqual(0);
    expect(phaseB).toBeGreaterThan(phaseA);
    for (const entry of [
      'target "build-compile-foundation"',
      'target "build-compile"',
      'targets = ["compile-web-extension-dependencies"]',
      'variable "GHA_CACHE_PARENT_SCOPE_SUFFIX"',
      "nook-build-compile${GHA_CACHE_SCOPE_SUFFIX}",
      "nook-build-compile${GHA_CACHE_PARENT_SCOPE_SUFFIX}",
      "compile_foundation_cache_from",
      "compile_source_cache_from",
    ]) {
      expect(bake).toContain(entry);
    }
    expect(bake).toContain('cache-to = ["${compile_foundation_cache_to}"]');
    expect(bake).toContain("mode=max,compression=zstd,timeout=20s");
    expect(bake).not.toContain("ignore-error=true");
    const sourceTarget = bake.slice(bake.indexOf('target "build-compile"'));
    expect(sourceTarget).toContain(
      'cache-from = ["${compile_source_cache_from}"]',
    );
    expect(sourceTarget).not.toContain("cache-to");
    expect(bake).toContain('inherits   = ["_sccache"]');
    for (const entry of [
      "FROM compile-wasm-dependencies AS compile-node-dependency-toolchain",
      "FROM compile-web-dependencies AS compile-web-extension-dependencies",
      "FROM compile-wasm-source AS compile",
      "COPY --from=compile-native-source",
      "COPY --from=compile-web /opt/nook/web-compile-passed",
      "COPY --from=compile-repository-tooling /opt/nook/repository-tooling-compile-passed",
      "COPY --from=compile-loom /opt/nook/loom-compile-passed",
    ]) {
      expect(dockerfile).toContain(entry);
    }
    expect(script).toContain("foundation_status=completed");
    expect(script).toContain("source_status=completed");
    expect(script).toContain(
      "trap 'compile_checkpoint_mark_interruption 143' TERM",
    );
    expect(script).toContain("NOOK_BUILDKIT_RAW_LOG_APPEND=1");
    expect(dockerfile).not.toContain("type=cache");
  }

  dylintWrapperContentInvalidatesBuildGraph(): void {
    const nightlyPath =
      "nook-app/nook-platform/docker/rust/nightly.Dockerfile";
    const nightly = this.read(nightlyPath);
    const bake = this.read(
      "nook-app/nook-platform/docker/rust/docker-bake.hcl",
    );
    const wrapper = this.read(
      "nook-app/nook-platform/docker/sccache-wrapper.sh",
    );
    const dockerignore = this.read(
      "nook-app/nook-platform/docker/rust/nightly.Dockerfile.dockerignore",
    );
    const ecosystemStage = nightly.indexOf(
      "FROM rust-base AS rust-ecosystem-nightly",
    );
    const ecosystemEnd = nightly.indexOf(
      "FROM rust-ecosystem-nightly AS rust-dylint-deps",
      ecosystemStage,
    );
    const wrapperCopy = nightly.indexOf(
      "COPY nook-app/nook-platform/docker/sccache-wrapper.sh /usr/local/bin/nook-sccache",
      ecosystemStage,
    );
    const wrapperMode = wrapper.indexOf(': "${SCCACHE_CLIENT_SIDE:=0}"');
    expect(ecosystemStage).toBeGreaterThanOrEqual(0);
    expect(ecosystemEnd).toBeGreaterThan(ecosystemStage);
    expect(wrapperCopy).toBeGreaterThan(ecosystemStage);
    expect(wrapperCopy).toBeLessThan(ecosystemEnd);
    expect(wrapperMode).toBeGreaterThanOrEqual(0);
    expect(dockerignore).not.toContain(
      "nook-app/nook-platform/docker/sccache-wrapper.sh",
    );
    expect(nightly).toContain(
      "RUN chmod 0755 /usr/local/bin/nook-sccache /usr/local/bin/nook-sccache-report",
    );

    const dylintTarget = bake.indexOf('target "rust-dylint"');
    const dylintTargetEnd = bake.indexOf(
      'target "rust-dylint-build"',
      dylintTarget,
    );
    expect(dylintTarget).toBeGreaterThanOrEqual(0);
    expect(dylintTargetEnd).toBeGreaterThan(dylintTarget);
    expect(bake.slice(dylintTarget, dylintTargetEnd)).toContain(
      "docker/rust/nightly.Dockerfile",
    );

    const dylintBuild = nightly.indexOf(
      "FROM rust-dylint-deps AS rust-dylint-build",
      ecosystemEnd,
    );
    const dylintSelfTest = nightly.indexOf(
      "FROM rust-dylint-build AS rust-dylint-self-test",
      dylintBuild,
    );
    expect(dylintBuild).toBeGreaterThan(ecosystemEnd);
    expect(dylintSelfTest).toBeGreaterThan(dylintBuild);
    expect(nightly.slice(dylintBuild, dylintSelfTest)).toContain(
      "cargo build --manifest-path dylint/nook-domain-api/Cargo.toml --locked",
    );
    expect(nightly.slice(dylintSelfTest)).toContain(
      "cargo llvm-cov test -p nook_domain_api",
    );
  }

  wasmNodeCompilerSecretsAndDylintTelemetryRuntime(): void {
    const product = this.read(
      "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    const requiredText = (
      values: readonly string[],
      index: number,
      label: string,
    ): string => {
      const value = values[index];
      if (typeof value !== "string") throw new Error(label);
      return value;
    };
    const nodeDeps = requiredText(
      requiredText(
        product.split("FROM wasm-coverage-toolchain AS builder-wasm-node-deps"),
        1,
        "WASM Node dependency stage is missing",
      ).split("# Source overlay for bulk native leaves"),
      0,
      "WASM Node dependency stage has no body",
    );
    const accessMount =
      "--mount=type=secret,id=sccache_s3_access_key,required=false";
    const secretMount =
      "--mount=type=secret,id=sccache_s3_secret_key,required=false";
    const compilerRuns = nodeDeps
      .split(/(?=^RUN\b)/m)
      .filter((run) => run.includes(accessMount));
    expect(compilerRuns).toHaveLength(2);
    expect(nodeDeps.match(/^RUN\b/gm)).toHaveLength(4);
    const hostCoverage = requiredText(
      compilerRuns,
      0,
      "WASM host coverage stage is missing",
    );
    const browserCoverage = requiredText(
      compilerRuns,
      1,
      "WASM browser coverage stage is missing",
    );
    const assertCompilerMounts = (stage: string, runCount: number): void => {
      expect(stage).toContain(accessMount);
      expect(stage).toContain(secretMount);
      expect(stage.match(/--mount=type=secret/g)).toHaveLength(2);
      expect(stage.match(/^RUN\b/gm)).toHaveLength(runCount);
    };
    assertCompilerMounts(hostCoverage, 1);
    assertCompilerMounts(browserCoverage, 1);
    const bunInstall = requiredText(
      requiredText(
        nodeDeps.split("RUN curl -fsSL https://bun.sh/install"),
        1,
        "Bun installation stage is missing",
      ).split("\n\n# Export cargo-llvm-cov"),
      0,
      "Bun installation stage has no body",
    );
    expect(bunInstall).not.toContain("--mount=type=secret");

    const stage = (startMarker: string, endMarker: string): string => {
      const start = product.indexOf(`\n${startMarker}\n`);
      const end = product.indexOf(`\n${endMarker}\n`, start + 1);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return product.slice(start + 1, end + 1);
    };
    const nodeCompilerStage = stage(
      "FROM builder-wasm-handoff AS builder-wasm-node-compiler",
      "FROM builder-wasm-handoff AS builder-wasm",
    );
    expect(nodeCompilerStage).toContain(
      "nook-sccache-report wasm-node-compiler",
    );
    expect(nodeCompilerStage).toContain(
      "nook-sccache-report --replay wasm-node-compiler",
    );
    expect(nodeCompilerStage).toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
    for (const stageName of [
      "wasm-source-nook-wasm",
      "wasm-source-companion-wasm",
      "wasm-clippy",
      "wasm-build-nook-wasm",
      "wasm-build-companion-wasm",
      "wasm-release-tests",
      "wasm-node-test-and-coverage",
      "wasm-node-compiler",
    ]) {
      expect(product).toContain(`nook-sccache-report --replay ${stageName}`);
    }
    for (const descendant of [
      stage(
        "FROM builder-wasm-node-deps AS builder-wasm-handoff",
        "FROM builder-wasm-handoff AS builder-wasm-node-compiler",
      ),
      nodeCompilerStage,
    ]) {
      assertCompilerMounts(descendant, 2);
      expect(descendant).not.toContain("RUSTC_WRAPPER=");
    }
    const browserStage = stage(
      "FROM builder-wasm-handoff AS builder-wasm",
      "FROM scratch AS wasm-export",
    );
    expect(browserStage).not.toContain("--mount=type=secret");
    expect([...browserStage.matchAll(/^RUN\b/gm)]).toHaveLength(0);

    const ecosystem = this.read(
      ".github/workflows/rust-ecosystem-checks.yml",
    );
    const dylintJob = ecosystem
      .split("\n  dylint:\n")[1];
    if (!dylintJob) throw new Error("Dylint job is missing");
    const nodeProvision = dylintJob.indexOf("actions/setup-node@v7");
    const dockerSetup = dylintJob.indexOf(
      "uses: ./.github/actions/nook-docker-setup",
    );
    expect(nodeProvision).toBeGreaterThanOrEqual(0);
    expect(nodeProvision).toBeLessThan(dockerSetup);
    expect(dylintJob).toContain('node-version: "24.19.0"');
    expect(this.read(".github/actions/nook-cache-telemetry/action.yml")).not.toContain(
      "skipping cache telemetry",
    );
    expect(this.read(".github/actions/nook-docker-setup/action.yml")).toContain(
      'node-version: "24.19.0"',
    );
    const nightly = this.read(
      "nook-app/nook-platform/docker/rust/nightly.Dockerfile",
    );
    for (const stageName of [
      "rust-dylint-self-test",
      "rust-dylint-native",
      "rust-dylint-wasm",
    ]) {
      expect(nightly).toContain(
        `nook-sccache-report --replay ${stageName}`,
      );
    }
    const report = this.read("nook-app/nook-platform/docker/sccache-report.sh");
    expect(report).toContain('report_dir="${NOOK_SCCACHE_REPORT_DIR:-/opt/nook/sccache-reports}"');
    expect(report).toContain('if [ "$stage" = --replay ]; then');
    expect(report).toContain('printf \'%s\\n\' "$report" >"$report_dir/$stage.json"');
    const bake = this.read("nook-app/docker-bake.hcl");
    expect(bake).toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
    expect(this.read(".github/actions/nook-docker-setup/action.yml")).toContain(
      "NOOK_SCCACHE_TELEMETRY_REPLAY=${GITHUB_RUN_ID:-local}",
    );
  }

  sharedRustBaseDoesNotConsumeTelemetryReplayArgument(): void {
    const product = this.read(
      "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    const baseStart = product.indexOf(
      "\nFROM ${RUST_IMAGE} AS rust-base\n",
    );
    const baseEnd = product.indexOf("\nFROM ", baseStart + 1);
    expect(baseStart).toBeGreaterThanOrEqual(0);
    expect(baseEnd).toBeGreaterThan(baseStart);
    expect(product.slice(baseStart, baseEnd)).not.toContain(
      "NOOK_SCCACHE_TELEMETRY_REPLAY",
    );
    expect(product).toContain(
      "ARG NOOK_SCCACHE_TELEMETRY_REPLAY\nRUN if [ \"$NOOK_SCCACHE_TELEMETRY_REPLAY\" != disabled ]; then nook-sccache-report --replay wasm-source-nook-wasm; fi",
    );
  }

  workflowTooling(): void {
    for (const file of readdirSync(join(this.root, ".github/workflows"))) {
      if (!file.endsWith(".yml")) continue;
      const source = readFileSync(
        join(this.root, ".github/workflows", file),
        "utf8",
      );
      expect(source).not.toMatch(
        /uses: (?:dtolnay\/rust-toolchain|Swatinem\/rust-cache)/,
      );
      expect(source).not.toMatch(/^\s*(?:run:\s*)?(?:cargo|rustup|rustfmt)\s/m);
    }
    const ecosystem = this.read(".github/workflows/rust-ecosystem-checks.yml");
    expect(ecosystem).toContain("SCCACHE_OPTIONAL:");
    expect(ecosystem).toContain("'dependabot[bot]') && '1' || ''");
    expect(ecosystem.match(/uses: docker\/setup-buildx-action/g)).toHaveLength(
      3,
    );
    let routedJobs = 0;
    for (const line of ecosystem.split("\n")) {
      if (!line.trimStart().startsWith("runs-on:")) continue;
      routedJobs += 1;
      expect(line).toContain(
        "github.event.pull_request.head.repo.full_name == github.repository",
      );
      expect(line).toContain(
        "github.event.pull_request.user.login != 'dependabot[bot]'",
      );
      expect(line).toContain(
        "(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'",
      );
    }
    expect(routedJobs).toBe(3);

    expect(this.read(".github/formatting/Dockerfile")).toContain(
      "prettier-skill.json",
    );
    const audit = this.read(".github/docker/rust-maintenance.hcl");
    expect(audit).toContain('no-cache-filter = ["audit"]');
    expect(audit).not.toContain("no-cache = true");
    expect(this.read(".github/scripts/remote-task-batch.sh")).toContain(
      'loom:verify) run_with_timeout "$timeout_minutes" task preflight:loom-verify',
    );
    const dockerignore = this.read(".dockerignore").split("\n");
    const generatedWasm =
      "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm";
    expect(dockerignore).toContain(`${generatedWasm}*`);
    expect(
      dockerignore.indexOf(`!${generatedWasm}/.gitignore`),
    ).toBeGreaterThan(dockerignore.indexOf(`${generatedWasm}*`));
    expect(dockerignore).toContain("**/node_modules");
  }

  compileExtensionUsesOwnFrozenDependencies(): void {
    const compile = this.read(
      "nook-app/nook-platform/docker/rust/compile.Dockerfile",
    );
    const extensionDependencyStage = compile.indexOf(
      "FROM compile-web-dependencies AS compile-web-extension-dependencies",
    );
    const webStage = compile.indexOf("FROM web-base AS compile-web");
    const extensionTypecheck = compile.indexOf(
      "RUN cd nook-app/nook-web/nook-web-extension",
    );
    const extensionBuild = compile.indexOf(
      "bun scripts/build.ts",
      extensionTypecheck,
    );
    expect(extensionDependencyStage).toBeGreaterThanOrEqual(0);
    expect(webStage).toBeGreaterThan(extensionDependencyStage);
    expect(extensionTypecheck).toBeGreaterThan(webStage);
    expect(extensionBuild).toBeGreaterThan(extensionTypecheck);

    const dependencyStage = compile.slice(extensionDependencyStage, webStage);
    expect(dependencyStage).toContain(
      "COPY nook-app/nook-web/nook-web-extension/package.json nook-app/nook-web/nook-web-extension/bun.lock",
    );
    expect(dependencyStage).toContain("bun install --frozen-lockfile");

    const webBuildStage = compile.slice(webStage, extensionTypecheck);
    expect(webBuildStage).toContain(
      "COPY --from=compile-web-extension-dependencies /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules",
    );
    expect(webBuildStage).not.toContain(
      "ln -s ../nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/nook-web-extension/node_modules",
    );
  }

  portableGitMetadata(): void {
    const temporary = mkdtempSync(join(tmpdir(), "nook-policy-git-"));
    try {
      this.command({ cwd: temporary, args: ["init", "-q"] });
      this.command({
        cwd: temporary,
        args: ["config", "user.email", "test@example.invalid"],
      });
      this.command({
        cwd: temporary,
        args: ["config", "user.name", "Policy Test"],
      });
      writeFileSync(join(temporary, "source.txt"), "baseline\n");
      this.command({ cwd: temporary, args: ["add", "."] });
      this.command({ cwd: temporary, args: ["commit", "-qm", "baseline"] });
      const base = this.command({
        cwd: temporary,
        args: ["rev-parse", "HEAD"],
      }).trim();
      this.command({
        cwd: temporary,
        args: ["update-ref", "refs/remotes/origin/main", base],
      });
      writeFileSync(join(temporary, "source.txt"), "head\n");
      this.command({ cwd: temporary, args: ["commit", "-qam", "head"] });
      this.command({
        cwd: temporary,
        args: [
          "config",
          "http.https://example.invalid/.extraheader",
          "fixture-credential",
        ],
      });
      writeFileSync(join(temporary, ".git/hooks/pre-commit"), "fixture-hook");
      const event = join(temporary, "event.json");
      writeFileSync(
        event,
        JSON.stringify({ pull_request: { base: { sha: base } } }),
      );
      const task = tasksSchema.parse(
        Bun.YAML.parse(this.read("preflight/Taskfile.yml")),
      );
      const command = task.tasks["preflight:policy:run"].cmds[0];
      if (!command) throw new Error("Policy command missing");
      const prefix = command
        .slice(0, command.indexOf("PREFLIGHT_SOURCE_CONTEXT="))
        .replaceAll("{{.REPO_ROOT}}", temporary)
        .replaceAll("{{.POLICY_STAGE}}", "repository-policy");
      const result = spawnSync(
        "bash",
        [
          "-c",
          prefix +
            `
        test "$(git --git-dir="$metadata/git" show HEAD:source.txt)" = head
        test "$(git --git-dir="$metadata/git" show origin/main:source.txt)" = baseline
        test "$(git --git-dir="$metadata/git" ls-files)" = source.txt
        test ! -e "$metadata/git/objects/info/alternates"
        test ! -e "$metadata/git/hooks/pre-commit"
        ! git --git-dir="$metadata/git" config --get-regexp 'http.*extraheader'
        ! git --git-dir="$metadata/git" config --get remote.origin.url
        test "$(jq -r .pull_request.base.sha "$metadata/event.json")" = '${base}'
      `,
        ],
        { encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: event } },
      );
      expect(result.status, result.stderr).toBe(0);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  formatterExport(): void {
    const temporary = mkdtempSync(join(tmpdir(), "nook-formatter-export-"));
    try {
      const implementation = join(temporary, "implementation");
      const bin = join(temporary, "bin");
      mkdirSync(join(implementation, "preflight"), { recursive: true });
      mkdirSync(join(implementation, ".git"));
      mkdirSync(bin);
      writeFileSync(join(implementation, ".git/config"), "fixture-credential");
      writeFileSync(join(implementation, "preflight/selected.rs"), "before\n");
      writeFileSync(join(implementation, "untouched.txt"), "untouched\n");
      writeFileSync(join(temporary, "outside.txt"), "outside\n");
      symlinkSync(temporary, join(implementation, "escape"));
      const dockerLog = join(temporary, "docker.log");
      writeFileSync(
        join(bin, "docker"),
        `#!/bin/bash
  set -euo pipefail
  printf 'called\\n' >> "$DOCKER_LOG"
  for arg in "$@"; do
    case "$arg" in
      format-export.contexts.implementation-source=*) source_dir="\u0024{arg#*=}" ;;
      format-export.output=type=local,dest=*) output_dir="\u0024{arg#*dest=}" ;;
    esac
  done
  test -f "$source_dir/preflight/selected.rs"
  test ! -e "$source_dir/.git"
  test ! -e "$source_dir/untouched.txt"
  if [ "$FORMAT_EXPORT_MODE" = complete ]; then
    mkdir -p "$output_dir/preflight"
    printf 'formatted\\n' > "$output_dir/preflight/selected.rs"
    printf 'must not be applied\\n' > "$output_dir/untouched.txt"
  fi
  `,
        { mode: 0o755 },
      );
      const files = join(temporary, "files");
      for (const scenario of [
        "complete",
        "missing",
        "escape",
        "traversal",
        "git",
      ]) {
        const path =
          scenario === "escape"
            ? "escape/outside.txt"
            : scenario === "traversal"
              ? "../outside.txt"
              : scenario === "git"
                ? ".git/config"
                : "preflight/selected.rs";
        writeFileSync(files, `${path}\0`);
        writeFileSync(dockerLog, "");
        const result = spawnSync(
          "task",
          [
            "--taskfile",
            join(this.root, "Taskfile.yml"),
            "ci:format:implementation",
          ],
          {
            cwd: this.root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              FORMAT_CHANGED_FILES: files,
              REPO_ROOT: this.root,
              IMPLEMENTATION_REPO_ROOT: implementation,
              DOCKER_LOG: dockerLog,
              FORMAT_EXPORT_MODE: scenario,
            },
          },
        );
        if (scenario === "complete") {
          expect(result.status, result.stderr).toBe(0);
          expect(
            readFileSync(join(implementation, "preflight/selected.rs"), "utf8"),
          ).toBe("formatted\n");
        } else {
          expect(result.status).not.toBe(0);
          if (scenario !== "missing")
            expect(readFileSync(dockerLog, "utf8")).toBe("");
        }
        expect(
          readFileSync(join(implementation, "untouched.txt"), "utf8"),
        ).toBe("untouched\n");
        expect(readFileSync(join(temporary, "outside.txt"), "utf8")).toBe(
          "outside\n",
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  formatterContext(): void {
    const temporary = mkdtempSync(join(tmpdir(), "nook-format-context-"));
    try {
      const shared =
        "nook-app/nook-web/nook-web-shared/src/vault-app/fixture.ts";
      const skill =
        ".cortex/teams/ai/dynamic-skills/new-fixture/scripts/src/fixture.ts";
      const prelude = this.read(".github/formatting/ci.Dockerfile").match(
        /^RUN mkdir -p .+$/m,
      );
      if (!prelude)
        throw new Error("CI formatter working directory setup missing");
      for (const path of [shared, skill]) {
        const directory = path.slice(0, path.lastIndexOf("/"));
        mkdirSync(join(temporary, directory), { recursive: true });
        writeFileSync(
          join(temporary, path),
          'export const value={name:"example"}\n',
        );
        const files = join(temporary, "files");
        writeFileSync(files, `${path}\0`);
        const prepare = prelude[0].slice(4).replaceAll("/workspace", temporary);
        const result = spawnSync(
          "bash",
          ["-c", `${prepare}\nbash "$FORMAT_SCRIPT"`],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              NOOK_REPO_ROOT: temporary,
              NOOK_FORMATTER_ROOT: join(this.root, ".github/formatting"),
              FORMAT_CHANGED_FILES: files,
              FORMAT_SCRIPT: join(this.root, ".github/formatting/format.sh"),
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const quote = path === shared ? '"' : "'";
        expect(readFileSync(join(temporary, path), "utf8")).toBe(
          `export const value = { name: ${quote}example${quote} };\n`,
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  compilerFirstWebVerification(): void {
    const taskSchema = z.object({
      tasks: z.record(
        z.string(),
        z.object({
          deps: z.array(z.string()).default([]),
          cmds: z
            .array(z.union([z.string(), z.object({ task: z.string() })]))
            .default([]),
        }),
      ),
    });
    const tasks = taskSchema.parse(
      Bun.YAML.parse(this.read("nook-app/Taskfile.yml")),
    ).tasks;
    const testTask = tasks["_test:parallel"];
    const compileTask = tasks["_compile:parallel"];
    const unitTask = tasks["_unit:parallel"];
    const lintTask = tasks["_lint:parallel"];
    if (!testTask || !compileTask || !unitTask || !lintTask) {
      throw new Error("Parallel task definitions are missing");
    }
    expect(
      testTask.cmds.map((command) =>
        typeof command === "string" ? command : command.task,
      ),
    ).toEqual(["_compile:parallel", "_unit:parallel"]);
    expect(compileTask.deps.sort()).toEqual([
      "_extension:typecheck",
      "_web:check:parallel",
    ]);
    expect(unitTask.deps.sort()).toEqual([
      "_extension:test:parallel",
      "_web:test:parallel",
    ]);
    expect(testTask.deps).toEqual([]);
    expect(
      lintTask.cmds.map((command) =>
        typeof command === "string" ? command : command.task,
      ),
    ).toContain("_extension:lint:parallel");

    const extension = this.read(
      "nook-app/nook-web/nook-web-extension/Taskfile.yml",
    );
    expect(extension).toContain("_extension:lint:parallel:");
    expect(extension).toContain("bun run typecheck");
    expect(extension).toContain("bun run test:unit");

    const temporary = mkdtempSync(join(tmpdir(), "nook-compiler-first-"));
    try {
      const taskfile = join(temporary, "Taskfile.yml");
      const probe = join(temporary, "probe.log");
      writeFileSync(
        taskfile,
        `version: '3'
tasks:
  compiler:web:
    cmds:
      - sh -c 'echo compiler:web >> "$PROBE_LOG"; test "${"${FAIL_COMPILERS:-}"}" != 1'
  compiler:extension:
    cmds:
      - sh -c 'echo compiler:extension >> "$PROBE_LOG"; test "${"${FAIL_COMPILERS:-}"}" != 1'
  compiler:all:
    deps: [compiler:web, compiler:extension]
  unit:web:
    cmds:
      - sh -c 'echo unit:web >> "$PROBE_LOG"'
  unit:extension:
    cmds:
      - sh -c 'echo unit:extension >> "$PROBE_LOG"'
  unit:all:
    deps: [unit:web, unit:extension]
  verify:
    cmds:
      - task: compiler:all
      - task: unit:all
`,
      );
      for (const failure of ["1", "0"]) {
        writeFileSync(probe, "");
        const result = spawnSync("task", ["--taskfile", taskfile, "verify"], {
          encoding: "utf8",
          env: {
            ...process.env,
            FAIL_COMPILERS: failure,
            PROBE_LOG: probe,
          },
        });
        const output = readFileSync(probe, "utf8");
        expect(output).toContain("compiler:web");
        expect(output).toContain("compiler:extension");
        if (failure === "1") {
          expect(result.status).not.toBe(0);
          expect(output).not.toContain("unit:web");
          expect(output).not.toContain("unit:extension");
        } else {
          expect(result.status, result.stderr).toBe(0);
          expect(output).toContain("unit:web");
          expect(output).toContain("unit:extension");
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
  private command(request: GitFixtureCommand): string {
    const { cwd, args } = request;
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }
}

const contract = new DockerizedRustContract();
const e2eContract = new DockerizedRustE2eContract();
const toolingContract = new DockerizedRustToolingContract();
test(
  "PR browser scheduling preserves covering extension and Node gates",
  contract.previewGates.bind(contract),
);
test(
  "grouped ecosystem reports every result and fails for any failed check",
  contract.ecosystemResults.bind(contract),
);
test(
  "PR dedup retains standalone coverage and source-correct exports",
  contract.coverageAndExporter.bind(contract),
);
test(
  "trusted ARC Rust validation consumes the producer through BuildKit",
  contract.trustedRustConsumerUsesBuildKit.bind(contract),
);
test(
  "Dylint dependencies stay source-free and sccache uses server-side mode",
  contract.dylintDependencyCacheAndSccacheMode.bind(contract),
);
test(
  "remote compile publishes a rooted foundation before source-sensitive compile",
  contract.remoteCompileUsesTwoPhaseFoundation.bind(contract),
);
test(
  "Dylint compiler vertices consume the current wrapper content",
  contract.dylintWrapperContentInvalidatesBuildGraph.bind(contract),
);
test(
  "WASM Node compilers retain secrets and Dylint telemetry has Node",
  contract.wasmNodeCompilerSecretsAndDylintTelemetryRuntime.bind(contract),
);
test(
  "shared rust-base cache key excludes per-run sccache telemetry replay",
  contract.sharedRustBaseDoesNotConsumeTelemetryReplayArgument.bind(contract),
);
test(
  "workflow Rust tools are Docker owned and dependency audits stay live",
  contract.workflowTooling.bind(contract),
);
test(
  "sealed web compile installs extension dependencies from its own lockfile",
  contract.compileExtensionUsesOwnFrozenDependencies.bind(contract),
);
test(
  "policy Git metadata retains exact head and real baseline without credentials",
  contract.portableGitMetadata.bind(contract),
);

test(
  "trusted formatter exports only bounded files and rejects hostile paths",
  contract.formatterExport.bind(contract),
  15_000,
);

test(
  "actual formatter supports shared-only files and new skill packages",
  contract.formatterContext.bind(contract),
);
test(
  "e2e orchestration reports every selected suite before failing",
  e2eContract.e2eCompletion.bind(e2eContract),
);
test(
  "web verification aggregates compilers before starting unit suites",
  contract.compilerFirstWebVerification.bind(contract),
);
test(
  "tooling installs every package before checking successful installs",
  toolingContract.toolingStaticInstallsBeforeChecks.bind(toolingContract),
);
