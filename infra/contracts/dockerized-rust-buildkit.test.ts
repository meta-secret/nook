import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface RequiredCompilerTextSelection {
  readonly sections: readonly string[];
  readonly index: number;
  readonly label: string;
}

interface CompilerMountExpectation {
  readonly stage: string;
  readonly runCount: number;
}

interface DockerfileStageRange {
  readonly content: string;
  readonly startMarker: string;
  readonly endMarker: string;
}

class DockerizedRustBuildKitContract {
  private readonly root = resolve(import.meta.dir, "../..");

  trustedRustConsumerUsesBuildKit(): void {
    const workflow = this.read(".github/workflows/pr.yml");
    const rootWorkflow = this.read(".github/workflows/ci.yml");
    const dockerSetup = this.read(
      ".github/actions/nook-docker-setup/action.yml",
    );
    const rustDockerTasks = this.read(
      "nook-app/nook-platform/docker/Taskfile.yml",
    );
    const tasks = this.read("nook-app/ci/pr.yml");
    const bake = this.read("nook-app/ci/pr.docker-bake.hcl");
    const preflight = this.read("preflight/Dockerfile");
    const product = this.read(
      "nook-app/nook-platform/docker/rust/base/Dockerfile",
    );
    expect(workflow).toContain("Connect trusted persistent BuildKit");
    expect(rootWorkflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(dockerSetup).toContain("--password-stdin");
    expect(dockerSetup).not.toContain("docker/login-action");
    expect(workflow).toContain("BUILDKIT_PROGRESS: plain");
    expect(workflow).toContain("task --silent ci:pr:validate");
    expect(workflow).not.toContain("nook-cache-telemetry");
    expect(workflow).not.toContain("actions/upload-artifact");
    expect(workflow).toContain("GHA_CACHE_ENABLED=");
    expect(workflow).toContain("GHA_CACHE_WRITE_ENABLED=");
    expect(workflow).not.toMatch(
      /type=registry|needs\.rust-build|nook-pr-rust:|nook-pr-e2e:/,
    );
    expect(tasks).toContain("buildx bake");
    expect(tasks).toContain("coverage-export.output=type=cacheonly");
    expect(tasks).not.toContain("coverage-export.output=type=local");
    expect(tasks).toContain("pr-browser-artifacts.output=type=tar");
    expect(tasks).toContain("tar -xf '{{.PR_ARTIFACT_DIR}}/browser.tar'");
    expect(tasks).toContain(".package_lines_percent.nook_domain_api | numbers");
    expect(tasks).toContain(
      "rust-dylint.args.RUST_DYLINT_COVERAGE_FLOOR=$floor",
    );
    expect(tasks).not.toContain("rust-dylint-self-test.args");
    expect(tasks).not.toContain(
      'require("./nook-app/nook-platform/nook-core/coverage-floor.json")',
    );
    expect(tasks).not.toMatch(/docker\s+(?:pull|run|create|start|exec)\b/);
    expect(tasks).toContain(
      'task --taskfile "{{.REPO_ROOT}}/Taskfile.yml" preflight:repository-policy',
    );
    const rustDependencyStage = product.indexOf(
      "FROM chef-deps AS pr-rust-dependencies",
    );
    const rustSourceStage = product.indexOf(
      "FROM pr-rust-dependencies AS pr-rust-verify",
    );
    expect(rustDependencyStage).toBeGreaterThanOrEqual(0);
    expect(rustSourceStage).toBeGreaterThan(rustDependencyStage);
    expect(product.slice(rustDependencyStage, rustSourceStage)).not.toContain(
      "COPY nook-app/nook-platform/ ./",
    );
    const rustVerification = product.slice(
      rustSourceStage,
      product.indexOf("FROM scratch AS pr-wasm-artifacts"),
    );
    expect(rustVerification).toContain(
      "COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./",
    );
    expect(rustVerification).not.toContain("COPY nook-app/nook-platform/ ./");
    for (const crate of [
      "nook-app-common",
      "nook-authenticator-domain",
      "nook-replication",
      "nook-auth2",
      "nook-event-log",
      "nook-companion-core",
      "nook-core",
      "nook-companion-wasm",
      "nook-wasm",
      "nook-wasm-composition-tests",
    ]) {
      expect(rustVerification).toContain(
        `COPY nook-app/nook-platform/${crate} ${crate}`,
      );
    }
    expect(
      rustVerification.match(/cargo clippy --quiet --offline/g)?.length,
    ).toBe(9);
    expect(
      rustVerification.match(/cargo build --quiet --offline/g)?.length,
    ).toBe(7);
    expect(rustDockerTasks).toContain(
      'task --taskfile "{{.REPO_ROOT}}/Taskfile.yml" preflight:dependency-policy',
    );
    expect(bake).toContain('web-artifacts = "target:pr-wasm-artifacts"');
    expect(bake).toContain('output = ["type=cacheonly"]');
    expect(bake).toContain(
      'targets = ["pr-rust-verify", "pr-web-verification", "rust-dylint", "coverage-export", "builder-wasm", "pr-web-tests", "rust-ecosystem-deterministic", "rust-fuzz-smoke", "rust-kani"]',
    );
    expect(bake).not.toContain(
      'targets = ["pr-rust-verify", "pr-web-verification", "pr-web-build", "rust-dylint-wasm"]',
    );
    expect(preflight).toContain(
      "FROM policy-source AS pr-verification\nRUN --mount=type=secret,id=sccache_s3_access_key,required=false \\",
    );
    expect(preflight).toContain(
      "--mount=type=secret,id=sccache_s3_secret_key,required=false \\",
    );
    const policyTools = preflight.indexOf("FROM deps AS policy-tools");
    const preflightDependencies = preflight.slice(
      preflight.indexOf("FROM rust-base AS deps"),
      preflight.indexOf("FROM deps AS coverage-deps"),
    );
    expect(preflightDependencies).toContain(
      "cargo test --quiet --locked --test core_ownership --no-run",
    );
    expect(preflightDependencies).toContain(
      "cargo clippy --quiet --locked --all-targets",
    );
    const policySource = preflight.indexOf(
      "FROM policy-tools AS policy-source",
    );
    const preparedDependencies = preflight.indexOf(
      "RUN for directory in .cortex/teams/ai/dynamic-skills/*/scripts",
      policyTools,
    );
    expect(preparedDependencies).toBeGreaterThan(policyTools);
    expect(policySource).toBeGreaterThan(preparedDependencies);
    expect(preflight).toContain("task tooling:static:prepared");
    const preflightBuild = preflight.slice(
      preflight.indexOf("FROM deps AS build"),
      preflight.indexOf("FROM build AS test"),
    );
    expect(preflightBuild).toContain(
      "find src tests -type f -name '*.rs' -exec touch {} +",
    );
    expect(preflightBuild).toContain("cargo fmt --check");
    expect(preflightBuild).toContain("cargo clippy --quiet --offline");
    expect(preflightBuild).not.toContain("cargo build");
    const preflightCoverage = preflight.slice(
      preflight.indexOf("FROM build AS test"),
      preflight.indexOf("FROM registry.dev.nokey.sh/oven/bun:"),
    );
    expect(preflightCoverage).toContain(
      "cargo llvm-cov test --locked --no-clean -p nook-preflight --fail-under-lines",
    );
    expect(
      preflight.slice(
        preflight.indexOf("FROM policy-source AS pr-verification"),
        preflight.indexOf("FROM loom-verify AS repository-policy"),
      ),
    ).not.toContain("bun install");
    expect(this.read("preflight/Taskfile.yml")).toContain(
      'buildx history logs "$ref"',
    );
    expect(this.read("nook-app/nook-web/nook-web-app/package.json")).toContain(
      "bash .github/scripts/jscpd-summary.sh",
    );
  }

  dylintDependencyCacheAndSccacheMode(): void {
    const nightly = this.read(
      "nook-app/nook-platform/docker/rust/ecosystem/nightly/Dockerfile",
    );
    const product = this.read(
      "nook-app/nook-platform/docker/rust/base/Dockerfile",
    );
    const wrapper = this.read(
      "nook-app/nook-platform/docker/sccache-wrapper.sh",
    );
    const dependencyStage = nightly.indexOf(
      "FROM rust-dylint-toolchain AS rust-dylint-deps",
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
    expect(nightly).toContain("dylint/nook-domain-api/src \\");
    expect(nightly).toContain("cargo fetch --locked");
    expect(dependencyBuild).toBeGreaterThan(dependencyStage);
    expect(sourceStage).toBeGreaterThan(dependencyBuild);
    expect(nightly.slice(dependencyStage, sourceStage)).not.toContain(
      "COPY nook-app/nook-platform/dylint/nook-domain-api/ dylint/nook-domain-api/",
    );
    expect(sourceCopy).toBeGreaterThan(sourceStage);
    const productDependencies = nightly.indexOf(
      "FROM rust-dylint-build AS rust-dylint-product-deps",
    );
    const productSource = nightly.indexOf(
      "FROM rust-dylint-product-deps AS rust-dylint-native",
    );
    expect(productDependencies).toBeGreaterThan(sourceCopy);
    expect(productSource).toBeGreaterThan(productDependencies);
    expect(nightly.slice(productDependencies, productSource)).toContain(
      "cargo dylint --all -- --locked --all-targets",
    );
    expect(nightly.slice(productDependencies, productSource)).toContain(
      "--target wasm32-unknown-unknown --all-targets",
    );
    expect(nightly).not.toContain("--mount=type=cache");
    expect(nightly.slice(productSource)).toContain(
      "-type f -name '*.rs' -exec touch {} +",
    );
    expect(product).toContain("ENV SCCACHE_CLIENT_SIDE=0");
    expect(product).not.toContain("ENV SCCACHE_CLIENT_SIDE=1");
    expect(wrapper).toContain(': "${SCCACHE_CLIENT_SIDE:=0}"');
    expect(wrapper).not.toContain("SCCACHE_CLIENT_SIDE:=1");
  }

  remoteCompileUsesTwoPhaseFoundation(): void {
    const bake = this.read(
      "nook-app/nook-platform/docker/rust/compile/docker-bake.hcl",
    );
    const dockerfile = this.read(
      "nook-app/nook-platform/docker/rust/compile/Dockerfile",
    );
    const script = this.read(".github/scripts/compile-remote.sh");
    const phaseA = script.indexOf('"${bake_args[@]}" build-compile-foundation');
    const phaseB = script.indexOf(
      '"${bake_args[@]}" build-compile',
      phaseA + 1,
    );
    expect(phaseA).toBeGreaterThanOrEqual(0);
    expect(phaseB).toBeGreaterThan(phaseA);
    for (const entry of [
      'target "build-compile-foundation"',
      'target "build-compile"',
      'variable "GHA_CACHE_PARENT_SCOPE_SUFFIX"',
      "nook-build-compile${GHA_CACHE_SCOPE_SUFFIX}",
      "nook-build-compile${GHA_CACHE_PARENT_SCOPE_SUFFIX}",
      "compile_foundation_cache_from",
      "compile_source_cache_from",
    ]) {
      expect(bake).toContain(entry);
    }
    expect(bake).toContain("cache-to   = compile_foundation_cache_to");
    expect(bake).toContain("mode=max,compression=zstd,timeout=20s");
    expect(bake).not.toContain("ignore-error=true");
    const sourceTargetStart = bake.indexOf('target "build-compile"');
    const sourceTargetEnd = bake.indexOf("\n}", sourceTargetStart);
    expect(sourceTargetEnd).toBeGreaterThan(sourceTargetStart);
    const sourceTarget = bake.slice(sourceTargetStart, sourceTargetEnd);
    expect(sourceTarget).toContain("cache-from = compile_source_cache_from");
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
      "nook-app/nook-platform/docker/rust/ecosystem/nightly/Dockerfile";
    const nightly = this.read(nightlyPath);
    const bake = this.read(
      "nook-app/nook-platform/docker/rust/docker-bake.hcl",
    );
    const wrapper = this.read(
      "nook-app/nook-platform/docker/sccache-wrapper.sh",
    );
    const dockerignore = this.read(
      "nook-app/nook-platform/docker/rust/ecosystem/nightly/Dockerfile.dockerignore",
    );
    const ecosystemStage = nightly.indexOf(
      "FROM rust-base AS rust-ecosystem-nightly",
    );
    const ecosystemEnd = nightly.indexOf(
      "FROM rust-ecosystem-nightly AS rust-dylint-toolchain",
      ecosystemStage,
    );
    const dylintDependencies = nightly.indexOf(
      "FROM rust-dylint-toolchain AS rust-dylint-deps",
      ecosystemEnd,
    );
    const dylintInstall = nightly.indexOf(
      "cargo install cargo-dylint dylint-link",
      ecosystemEnd,
    );
    const wrapperCopy = nightly.indexOf(
      "COPY nook-app/nook-platform/docker/sccache-wrapper.sh /usr/local/bin/nook-sccache",
      ecosystemEnd,
    );
    const wrapperMode = wrapper.indexOf(': "${SCCACHE_CLIENT_SIDE:=0}"');
    expect(ecosystemStage).toBeGreaterThanOrEqual(0);
    expect(ecosystemEnd).toBeGreaterThan(ecosystemStage);
    expect(dylintInstall).toBeGreaterThan(ecosystemEnd);
    expect(wrapperCopy).toBeGreaterThan(dylintInstall);
    expect(wrapperCopy).toBeLessThan(dylintDependencies);
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
    expect(bake).toContain(
      'rust_nightly_dockerfile = "nook-app/nook-platform/docker/rust/ecosystem/nightly/Dockerfile"',
    );
    expect(bake.slice(dylintTarget, dylintTargetEnd)).toContain(
      "dockerfile = rust_nightly_dockerfile",
    );
    expect(bake.slice(dylintTarget, dylintTargetEnd)).toContain(
      'tags       = ["nook-rust-dylint:local"]',
    );
    expect(bake.slice(dylintTarget, dylintTargetEnd)).toContain(
      'output     = ["type=image,push=false"]',
    );
    expect(bake.slice(dylintTarget, dylintTargetEnd)).not.toContain(
      "type=cacheonly",
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

  wasmNodeCompilerSecretsWithoutReplayCacheBusters(): void {
    const product = this.read(
      "nook-app/nook-platform/docker/rust/base/Dockerfile",
    );
    const selectText = (request: RequiredCompilerTextSelection): string => {
      const value = request.sections[request.index];
      if (typeof value !== "string") throw new Error(request.label);
      return value;
    };
    const nodeDependencySections = product.split(
      "FROM wasm-coverage-toolchain AS builder-wasm-node-deps",
    );
    const nodeDependencyStageSelection: RequiredCompilerTextSelection = {
      sections: nodeDependencySections,
      index: 1,
      label: "WASM Node dependency stage is missing",
    };
    const nodeDependencyStage = selectText(nodeDependencyStageSelection);
    const nodeDependencyBodySections = nodeDependencyStage.split(
      "# Source overlay for bulk native leaves",
    );
    const nodeDependencyBodySelection: RequiredCompilerTextSelection = {
      sections: nodeDependencyBodySections,
      index: 0,
      label: "WASM Node dependency stage has no body",
    };
    const nodeDeps = selectText(nodeDependencyBodySelection);
    const accessMount =
      "--mount=type=secret,id=sccache_s3_access_key,required=false";
    const secretMount =
      "--mount=type=secret,id=sccache_s3_secret_key,required=false";
    const compilerRuns = nodeDeps
      .split(/(?=^RUN\b)/m)
      .filter((run) => run.includes(accessMount));
    expect(compilerRuns).toHaveLength(2);
    expect(nodeDeps.match(/^RUN\b/gm)).toHaveLength(4);
    const hostCoverageSelection: RequiredCompilerTextSelection = {
      sections: compilerRuns,
      index: 0,
      label: "WASM host coverage stage is missing",
    };
    const browserCoverageSelection: RequiredCompilerTextSelection = {
      sections: compilerRuns,
      index: 1,
      label: "WASM browser coverage stage is missing",
    };
    const hostCoverage = selectText(hostCoverageSelection);
    const browserCoverage = selectText(browserCoverageSelection);
    const assertCompilerMounts = (request: CompilerMountExpectation): void => {
      expect(request.stage).toContain(accessMount);
      expect(request.stage).toContain(secretMount);
      expect(request.stage.match(/--mount=type=secret/g)).toHaveLength(2);
      expect(request.stage.match(/^RUN\b/gm)).toHaveLength(request.runCount);
    };
    const hostCoverageMounts: CompilerMountExpectation = {
      stage: hostCoverage,
      runCount: 1,
    };
    const browserCoverageMounts: CompilerMountExpectation = {
      stage: browserCoverage,
      runCount: 1,
    };
    assertCompilerMounts(hostCoverageMounts);
    assertCompilerMounts(browserCoverageMounts);
    const bunInstallSections = nodeDeps.split(
      "RUN curl -fsSL https://bun.sh/install",
    );
    const bunInstallStageSelection: RequiredCompilerTextSelection = {
      sections: bunInstallSections,
      index: 1,
      label: "Bun installation stage is missing",
    };
    const bunInstallStage = selectText(bunInstallStageSelection);
    const bunInstallBodySections = bunInstallStage.split(
      "\n\n# Export cargo-llvm-cov",
    );
    const bunInstallBodySelection: RequiredCompilerTextSelection = {
      sections: bunInstallBodySections,
      index: 0,
      label: "Bun installation stage has no body",
    };
    const bunInstall = selectText(bunInstallBodySelection);
    expect(bunInstall).not.toContain("--mount=type=secret");

    const stage = (request: DockerfileStageRange): string => {
      const start = request.content.indexOf("\n" + request.startMarker + "\n");
      const end = request.content.indexOf(
        "\n" + request.endMarker + "\n",
        start + 1,
      );
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return request.content.slice(start + 1, end + 1);
    };
    const nodeCompilerStageRange: DockerfileStageRange = {
      content: product,
      startMarker: "FROM builder-wasm-handoff AS builder-wasm-node-compiler",
      endMarker: "FROM builder-wasm-handoff AS builder-wasm",
    };
    const nodeCompilerStage = stage(nodeCompilerStageRange);
    expect(nodeCompilerStage).toContain(
      "nook-sccache-report wasm-node-compiler",
    );
    expect(nodeCompilerStage).toContain(
      "llvm-cov test --no-clean --release -p nook-companion-wasm",
    );
    expect(nodeCompilerStage).not.toContain(
      "llvm-cov test --no-clean --release -p nook-companion-wasm --no-report",
    );
    expect(
      nodeCompilerStage.indexOf(
        "llvm-cov test --no-clean --release -p nook-companion-wasm",
      ),
    ).toBeLessThan(
      nodeCompilerStage.indexOf(
        "--target wasm32-unknown-unknown --release -p nook-companion-wasm --fail-under-lines",
      ),
    );
    expect(product).not.toContain("nook-sccache-report --replay");
    expect(product).not.toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
    const handoffStageRange: DockerfileStageRange = {
      content: product,
      startMarker: "FROM builder-wasm-node-deps AS builder-wasm-handoff",
      endMarker: "FROM builder-wasm-handoff AS builder-wasm-node-compiler",
    };
    const handoffStage = stage(handoffStageRange);
    for (const descendant of [handoffStage, nodeCompilerStage]) {
      const descendantMounts: CompilerMountExpectation = {
        stage: descendant,
        runCount: 1,
      };
      assertCompilerMounts(descendantMounts);
      expect(descendant).not.toContain("RUSTC_WRAPPER=");
    }
    const browserStageRange: DockerfileStageRange = {
      content: product,
      startMarker: "FROM builder-wasm-handoff AS builder-wasm",
      endMarker: "FROM scratch AS wasm-export",
    };
    const browserStage = stage(browserStageRange);
    expect(browserStage).not.toContain("--mount=type=secret");
    expect([...browserStage.matchAll(/^RUN\b/gm)]).toHaveLength(0);

    const ecosystem = this.read(".github/workflows/rust-ecosystem-checks.yml");
    const ecosystemJob = ecosystem.split("\n  checks:\n")[1];
    if (!ecosystemJob) throw new Error("Aggregated ecosystem job is missing");
    const nodeProvision = ecosystemJob.indexOf("actions/setup-node@v7");
    const dockerSetup = ecosystemJob.indexOf(
      "uses: ./.github/actions/nook-docker-setup",
    );
    expect(nodeProvision).toBe(-1);
    expect(dockerSetup).toBeGreaterThanOrEqual(0);
    expect(
      this.read(".github/actions/nook-cache-telemetry/action.yml"),
    ).not.toContain("skipping cache telemetry");
    expect(this.read(".github/actions/nook-docker-setup/action.yml")).toContain(
      'node-version: "24.19.0"',
    );
    const nightly = this.read(
      "nook-app/nook-platform/docker/rust/ecosystem/nightly/Dockerfile",
    );
    expect(nightly).not.toContain("nook-sccache-report --replay");
    expect(nightly).not.toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
    const report = this.read("nook-app/nook-platform/docker/sccache-report.sh");
    expect(report).toContain(
      'report_dir="${NOOK_SCCACHE_REPORT_DIR:-/opt/nook/sccache-reports}"',
    );
    expect(report).not.toContain('if [ "$stage" = --replay ]; then');
    expect(report).toContain(
      'printf \'%s\\n\' "$report" >"$report_dir/$stage.json"',
    );
    expect(this.read("nook-app/docker-bake.hcl")).not.toContain(
      "NOOK_SCCACHE_TELEMETRY_REPLAY",
    );
    expect(
      this.read(".github/actions/nook-docker-setup/action.yml"),
    ).not.toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
  }

  compilerGraphsDoNotConsumeTelemetryReplayArgument(): void {
    const product = this.read(
      "nook-app/nook-platform/docker/rust/base/Dockerfile",
    );
    const baseStart = product.indexOf(
      "\nFROM registry.dev.nokey.sh/library/rust:1.97-trixie@sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769 AS rust-base\n",
    );
    const baseEnd = product.indexOf("\nFROM ", baseStart + 1);
    expect(baseStart).toBeGreaterThanOrEqual(0);
    expect(baseEnd).toBeGreaterThan(baseStart);
    expect(product.slice(baseStart, baseEnd)).not.toContain(
      "NOOK_SCCACHE_TELEMETRY_REPLAY",
    );
    expect(product).not.toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
    expect(
      this.read("nook-app/nook-platform/docker/rust/compile/Dockerfile"),
    ).not.toContain("NOOK_SCCACHE_TELEMETRY_REPLAY");
  }

  prCacheProofCoversChefDependencyReuse(): void {
    const simulator = this.read("infra/sim/bake-cache/pr-pipeline.Dockerfile");
    const chefDependencies = this.read(
      "infra/sim/bake-cache/inputs/chef-dependencies.txt",
    );
    const dylintDependencies = this.read(
      "infra/sim/bake-cache/inputs/dylint-dependencies.txt",
    );
    const proof = this.read("infra/tasks/pr-cache.yml");
    expect(chefDependencies).toContain("Cargo.toml and Cargo.lock fixture");
    expect(dylintDependencies).toContain("cargo-dylint=6.0.1");
    expect(
      simulator.indexOf("COPY inputs/dylint-dependencies.txt"),
    ).toBeLessThan(simulator.indexOf("COPY inputs/chef-dependencies.txt"));
    expect(simulator.indexOf("COPY inputs/chef-dependencies.txt")).toBeLessThan(
      simulator.indexOf("COPY inputs/compile-web-source.txt"),
    );
    expect(simulator).not.toContain("SOURCE_REVISION");
    expect(simulator).toContain("bake-sim-cargo-chef-wasm-release");
    expect(simulator).toContain("bake-sim-cargo-dylint-product-dependencies");
    expect(proof).toContain('grep -qx "$dylint_dependency_vertex CACHED"');
    expect(proof).toContain(
      "Warm verification unexpectedly rebuilt Dylint product dependencies",
    );
    expect(proof).toContain('grep -qx "$dependency_vertex CACHED"');
    expect(proof).toContain(
      "Warm verification unexpectedly recooked WASM dependencies",
    );
    expect(simulator).toContain("bake-sim-fuzz-dependencies");
    expect(simulator).toContain("FROM tests AS coverage-export");
    expect(simulator).toContain("FROM prepared AS browser-artifacts");
    expect(proof).toContain('grep -qx "$fuzz_dependency_vertex CACHED"');
    expect(proof).toContain("phase=checks");
    expect(proof).toContain('"pr-proof-$phase"');
    expect(proof).toContain("cold-checks.log");
    expect(proof).toContain(
      "Warm check solve unexpectedly reinstalled fuzz dependencies",
    );
    expect(proof).toContain("grep -q 'exporting to image'");
    expect(proof).toContain(
      "Dylint verification unexpectedly used a cache-only/export-cache result",
    );
    expect(
      this.read("infra/sim/bake-cache/pr-pipeline.docker-bake.hcl"),
    ).toContain('output = ["type=image,push=false"]');
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
}

const contract = new DockerizedRustBuildKitContract();

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
  "WASM Node compilers retain secrets without replay cache busters",
  contract.wasmNodeCompilerSecretsWithoutReplayCacheBusters.bind(contract),
);
test(
  "compiler graphs exclude per-run sccache telemetry replay",
  contract.compilerGraphsDoNotConsumeTelemetryReplayArgument.bind(contract),
);
test(
  "local PR cache proof covers Dylint and Cargo Chef dependency reuse",
  contract.prCacheProofCoversChefDependencyReuse.bind(contract),
);
