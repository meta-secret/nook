use anyhow::{Context, bail};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::str::Lines;

#[test]
fn every_rust_package_has_an_explicit_coverage_policy() -> anyhow::Result<()> {
    let root = repository_root()?;
    let policy =
        CoveragePolicy::read(&root.join("nook-app/nook-platform/nook-core/coverage-floor.json"))?;
    let enforced = policy.enforced_packages.clone();
    let excluded: BTreeMap<_, _> = policy
        .excluded_packages
        .iter()
        .map(|entry| (entry.package.clone(), entry.reason.clone()))
        .collect();
    let excluded_names = excluded.keys().cloned().collect::<BTreeSet<_>>();
    let discovered = discover_packages(&root)?;
    let classified: BTreeSet<_> = enforced.union(&excluded_names).cloned().collect();
    let discovered_names = discovered.keys().cloned().collect::<BTreeSet<_>>();
    assert_eq!(discovered_names, classified);
    assert!(enforced.is_disjoint(&excluded_names));
    assert!(policy.lines_percent >= 90.0);
    let package_floors = &policy.package_lines_percent;
    let floor_names = package_floors.keys().cloned().collect::<BTreeSet<_>>();
    assert_eq!(floor_names, enforced);
    for (package, floor) in package_floors {
        let expected = match package.as_str() {
            "nook-wasm" => 70.0,
            _ => 90.0,
        };
        assert!(*floor >= expected);
    }
    assert_eq!(
        excluded
            .get("nook-fuzz")
            .context("coverage policy must explain the nook-fuzz exclusion")?,
        "Intentional non-testable cargo-fuzz harness; covered behavior belongs to nook-auth2."
    );
    Ok(())
}
#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one coverage contract verifies every hosted package decision"
)]
fn every_enforced_package_has_an_independent_hosted_failure_decision() -> anyhow::Result<()> {
    let root = repository_root()?;
    let product = read(&root.join("nook-app/nook-platform/docker/rust/base/Dockerfile"))?;
    let companion =
        read(&root.join("nook-app/nook-platform/docker/rust/base/wasm-companion-verify.sh"))?;
    let nook = read(&root.join("nook-app/nook-platform/docker/rust/base/wasm-nook-verify.sh"))?;
    let nightly =
        read(&root.join("nook-app/nook-platform/docker/rust/ecosystem/nightly/Dockerfile"))?;
    let docker_tasks = read(&root.join("nook-app/nook-platform/docker/Taskfile.yml"))?;
    let wasm_bake = read(&root.join("nook-app/nook-platform/nook-wasm/docker-bake.hcl"))?;
    let platform_tasks = read(&root.join("nook-app/nook-platform/Taskfile.yml"))?;
    let central_ci = read(&root.join(".github/workflows/ci.yml"))?;
    let preflight = read(&root.join("preflight/Dockerfile"))?;
    let fuzz_manifest = read(&root.join("nook-app/nook-platform/fuzz/Cargo.toml"))?;
    let policy =
        CoveragePolicy::read(&root.join("nook-app/nook-platform/nook-core/coverage-floor.json"))?;
    let enforced = policy.enforced_packages.clone();
    for package in &enforced {
        assert!(
            [
                &product,
                &companion,
                &nook,
                &nightly,
                &platform_tasks,
                &preflight
            ]
            .iter()
            .flat_map(|source| source.lines())
            .filter(|line| line.contains("llvm-cov") || line.contains("for package in"))
            .flat_map(|line| line.split(|c: char| c.is_whitespace() || c == ';' || c == '"'))
            .any(|word| word == package),
            "{package} has no hosted coverage command"
        );
    }
    let portable = "nook-app-common nook-authenticator-domain nook-auth2 nook-replication nook-event-log nook-companion-core nook-core";
    assert!(product.contains(&format!("for package in {portable}; do")));
    assert!(platform_tasks.contains(&format!("packages=\"{portable}\"")));
    assert!(product.contains(".package_lines_percent[$package]"));
    assert!(platform_tasks.contains(".package_lines_percent[$package]"));
    assert!(product.contains("--fail-under-lines \"$floor\""));
    assert!(platform_tasks.contains("--fail-under-lines \"$floor\""));
    assert!(platform_tasks.contains("set -e") && platform_tasks.contains("|| coverage_status=1"));
    assert!(nightly.contains("cargo llvm-cov test -p nook_domain_api"));
    assert!(nightly.contains("rustup show active-toolchain | cut -d' ' -f1"));
    let dylint_object = "dylint/nook-domain-api/target/debug/libnook_domain_api@${toolchain_id}.so";
    assert!(nightly.contains(dylint_object));
    assert!(nightly.contains("ARG RUST_DYLINT_COVERAGE_FLOOR"));
    assert!(nightly.contains("--fail-under-lines \"${RUST_DYLINT_COVERAGE_FLOOR:?}\""));
    assert!(docker_tasks.contains(".package_lines_percent[\"nook_domain_api\"] | numbers"));
    assert_eq!(
        docker_tasks.matches("RUST_DYLINT_COVERAGE_FLOOR=").count(),
        1
    );
    assert!(nightly.contains("target/llvm-cov-target/debug/libnook_domain_api-c0ffee.so"));
    assert!(companion.contains(".package_lines_percent[\"nook-companion-wasm\"]"));
    assert!(product.contains("llvm-cov clean --workspace"));
    assert!(product.contains("llvm-cov test --no-clean --release -p nook-wasm"));
    assert!(product.contains("llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests"));
    assert!(!product.contains("--no-clean --release -p nook-wasm --no-report"));
    assert!(product.contains("CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=true"));
    assert!(nook.contains("export WASM_BINDGEN_TEST_TIMEOUT=60"));
    assert_eq!(product.matches("--features browser-wasm-tests").count(), 2);
    assert_eq!(nook.matches("--features browser-wasm-tests").count(), 1);
    assert!(nook.contains(".package_lines_percent[\"nook-wasm\"]"));
    assert!(nook.contains("llvm-cov report --target wasm32-unknown-unknown --release -p nook-wasm --fail-under-lines \"$nook_wasm_floor\""));
    let wasm_node_deps = product
        .split_once("FROM wasm-coverage-toolchain AS builder-wasm-node-deps")
        .and_then(|(_, remainder)| {
            remainder
                .split_once("# Source overlay for bulk native leaves")
                .map(|(stage, _)| stage)
        })
        .context("WASM Node dependencies must be a bounded source-free stage")?;
    assert!(wasm_node_deps.contains("apt-get install -y --no-install-recommends clang"));
    assert!(wasm_node_deps.contains("https://bun.sh/install"));
    assert!(wasm_node_deps.contains("sha256sum -c -"));
    assert!(
        wasm_node_deps
            .split_once("llvm-cov clean --workspace")
            .is_some_and(|(_, later)| later.contains("llvm-cov show-env --sh"))
    );
    assert!(wasm_node_deps.contains("llvm-cov show-env --sh --target wasm32-unknown-unknown"));
    assert_eq!(
        wasm_node_deps
            .matches("CARGO_TARGET_DIR=target/llvm-cov-target")
            .count(),
        4
    );
    assert!(wasm_node_deps.contains("test --release -p nook-wasm --no-run"));
    assert!(wasm_node_deps.contains(
        "test --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --no-run"
    ));
    let compiler_runs = DockerfileRunInstruction::parse_stage(wasm_node_deps)
        .into_iter()
        .filter(|run| run.contains("--no-run"))
        .collect::<Vec<_>>();
    assert_eq!(compiler_runs.len(), 2);
    let [native_run, wasm_run] = compiler_runs.as_slice() else {
        bail!("WASM Node dependency warming must have exactly two compiler RUNs");
    };
    assert!(native_run.contains("llvm-cov show-env --sh"));
    assert!(!native_run.contains("--target wasm32-unknown-unknown"));
    assert!(wasm_run.contains("llvm-cov show-env --sh --target wasm32-unknown-unknown"));
    assert!(wasm_run.contains("--target wasm32-unknown-unknown"));
    assert!(!wasm_node_deps.contains("llvm-cov test"));
    assert!(!wasm_node_deps.contains("llvm-cov --no-run"));
    assert!(!wasm_node_deps.contains("RUSTC_WRAPPER="));
    let wasm_coverage_stage = product
        .split_once("FROM builder-wasm-node-deps AS builder-wasm-test-base")
        .and_then(|(_, remainder)| {
            remainder
                .split_once("FROM scratch AS wasm-export")
                .map(|(stage, _)| stage)
        })
        .context("builder-wasm must be a bounded product image stage")?;
    assert!(wasm_coverage_stage.contains(
        "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS=\"-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage\""
    ));
    let (handoff, companion_and_nook) = wasm_coverage_stage
        .split_once("\nFROM builder-wasm-test-base AS builder-companion-wasm-node-compiler")
        .context("companion compiler must branch before nook coverage")?;
    let (companion_leaf, compiler_and_browser) = companion_and_nook
        .split_once("\nFROM builder-wasm-handoff AS builder-nook-wasm-browser-input")
        .context("nook compiler must retain its native coverage handoff")?;
    assert!(handoff.contains("FROM builder-wasm-test-base AS builder-wasm-handoff"));
    assert!(
        companion_leaf
            .contains("COPY nook-app/nook-platform/docker/rust/base/wasm-companion-verify.sh")
    );
    assert!(companion_leaf.contains("bash /opt/nook/wasm-companion-verify.sh"));
    assert!(companion.contains("set -euo pipefail"));
    assert!(!companion.contains("RUSTC_WRAPPER="));
    assert!(!companion_leaf.contains("--mount=type=cache"));
    assert!(!handoff.contains("bun.sh/install"));
    let (compiler, browser) = compiler_and_browser
        .split_once("\nFROM builder-wasm-handoff AS builder-wasm")
        .context("isolated Node compiler and secret-free browser validation stages")?;
    WasmCoverageHandoff { source: handoff }.require_compiler_wrapper()?;
    assert!(!compiler.contains("RUSTC_WRAPPER="));
    assert!(nook.contains("wasm-pack test --node --release nook-wasm"));
    assert!(companion.contains("wasm-pack test --node --release nook-companion-wasm"));
    assert!(!compiler.contains("--release nook-companion-wasm"));
    assert!(compiler.contains("FROM builder-nook-wasm-node-compiler AS builder-wasm-node-compiler\nCOPY --from=builder-companion-wasm-node-compiler /opt/nook/wasm-companion-verified /opt/nook/wasm-companion-verified"));
    let companion_native_coverage = "llvm-cov test --no-clean --release -p nook-companion-wasm";
    let companion_wasm_coverage = "llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-companion-wasm --fail-under-lines \"$companion_floor\"";
    assert!(companion.contains(companion_native_coverage));
    assert!(
        !companion
            .contains("llvm-cov test --no-clean --release -p nook-companion-wasm --no-report")
    );
    assert!(companion.contains(companion_wasm_coverage));
    assert!(
        companion.find(companion_native_coverage) < companion.find(companion_wasm_coverage),
        "native companion tests must contribute profiles before the wasm package floor is evaluated"
    );
    assert!(
        companion.find(companion_wasm_coverage)
            < companion.find("touch /opt/nook/wasm-companion-verified")
    );
    for secret in ["sccache_s3_access_key", "sccache_s3_secret_key"] {
        assert!(
            companion_leaf.contains(&format!("--mount=type=secret,id={secret},required=false"))
        );
    }
    assert_eq!(
        compiler
            .matches("--mount=type=secret,id=sccache_s3_access_key,required=false")
            .count(),
        1
    );
    assert_eq!(
        compiler
            .matches("--mount=type=secret,id=sccache_s3_secret_key,required=false")
            .count(),
        1
    );
    assert!(!compiler.contains("bun.sh/install"));
    assert!(!compiler.contains("apt-get install"));
    assert!(
        browser.contains("COPY --from=builder-wasm-node-compiler /opt/nook/wasm-node-tests-passed")
    );
    assert!(!browser.contains("wasm-pack test --node"));
    assert!(!browser.contains("bun.sh/install"));
    assert!(!browser.contains("--mount=type=secret"));
    assert!(product.contains("--from=builder-wasm-handoff /opt/nook/wasm-handoff"));
    assert!(product.contains("--from=builder-wasm /opt/nook/wasm-coverage-passed"));
    assert!(product.contains("FROM builder-wasm-handoff AS nook-rust"));
    let node_compiler_target = wasm_bake
        .split_once("target \"builder-wasm-node-compiler\" {")
        .and_then(|(_, remainder)| remainder.split_once("\n}"))
        .map(|(target, _)| target)
        .context("WASM Bake must expose the isolated Node compiler target")?;
    assert!(node_compiler_target.contains("target     = \"builder-wasm-node-compiler\""));
    assert!(node_compiler_target.contains("cache-from = rust_wasm_source_cache_from"));
    assert!(node_compiler_target.contains("output     = [\"type=cacheonly\"]"));
    assert!(
        central_ci.contains("on:\n  pull_request:")
            && central_ci.contains("push:\n    branches: [main]")
    );
    assert!(!central_ci.contains("dev-promotion-readiness:"));
    assert!(central_ci.contains("uses: ./.github/workflows/pr.yml"));
    assert!(!central_ci.contains("github.event.pull_request.head.ref == 'dev'"));
    let preflight_gate =
        "cargo llvm-cov test --locked --no-clean -p nook-preflight --fail-under-lines \"$floor\"";
    assert!(preflight.contains(preflight_gate));
    DockerfileRunInstruction::preflight_fixture_coverage(&preflight)?.require_fixture_floor()?;
    assert!(preflight.contains("WORKDIR /meta-secret/nook/preflight"));
    let preflight_coverage_deps = preflight
        .split_once("FROM deps AS coverage-deps")
        .and_then(|(_, remainder)| {
            remainder
                .split_once("FROM deps AS build")
                .map(|(stage, _)| stage)
        })
        .context("preflight coverage dependencies must be a bounded source-free stage")?;
    assert!(preflight_coverage_deps.contains("cargo llvm-cov clean --workspace"));
    assert!(preflight_coverage_deps.contains("cargo llvm-cov show-env --sh"));
    assert!(preflight_coverage_deps.contains(
        "CARGO_TARGET_DIR=/meta-secret/preflight-target/llvm-cov-target cargo test --locked -p nook-preflight --no-run"
    ));
    assert!(!preflight_coverage_deps.contains("COPY --from=repository-source"));
    let target_envs = preflight
        .matches("ENV CARGO_TARGET_DIR=/meta-secret/preflight-target")
        .count();
    assert_eq!(target_envs, 2);
    assert!(preflight.contains("ENV NOOK_REPO_ROOT=/meta-secret/nook"));
    assert!(preflight.contains(".package_lines_percent[\"nook-preflight\"] | numbers"));
    assert!(!preflight.contains("/meta-secret/nook/preflight/target"));
    assert!(!preflight.contains("/opt/nook/preflight"));
    assert!(!preflight.contains("/opt/nook/coverage-floor.json"));
    assert!(fuzz_manifest.contains("cargo-fuzz = true") && fuzz_manifest.contains("test = false"));
    Ok(())
}
#[test]
fn wasm_browser_partitions_preserve_the_complete_instrumented_coverage_join() -> anyhow::Result<()>
{
    let root = repository_root()?;
    let product = read(&root.join("nook-app/nook-platform/docker/rust/base/Dockerfile"))?;
    let nook = read(&root.join("nook-app/nook-platform/docker/rust/base/wasm-nook-verify.sh"))?;
    assert!(nook.contains("set -euo pipefail"));
    assert!(nook.contains("llvm-cov show-env --sh --target wasm32-unknown-unknown"));
    assert!(nook.contains("test --tests --target wasm32-unknown-unknown --release -p nook-wasm --features browser-wasm-tests --no-run --message-format=json-render-diagnostics"));
    assert_eq!(nook.matches("--no-run").count(), 1);
    assert!(nook.contains(
        ".reason == \"compiler-artifact\" and .profile.test == true and .executable != null"
    ));
    assert!(nook.contains("unique_by(.executable) | if length == 1 and .[0].target.name == \"nook_wasm\" then .[0].executable else error("));
    for selection in ["--list", "manager:: --list", "--skip manager:: --list"] {
        assert!(nook.contains(&format!("\"$runner\" \"$wasm\" {selection} >")));
    }
    assert!(nook.contains("comm -12 \"$inventory/manager\" \"$inventory/rest\""));
    assert!(nook.contains("test ! -s \"$inventory/overlap\""));
    assert!(nook.contains("cmp \"$inventory/all\" \"$inventory/union\""));
    assert!(!nook.contains("--include-ignored") && !nook.contains("--ignored"));
    assert!(nook.contains("export TMPDIR=\"/tmp/nook-wasm-$partition\""));
    assert!(nook.contains(
        "export LLVM_PROFILE_FILE=\"/opt/nook/wasm-browser-profiles/$partition-%p-%m.profraw\""
    ));
    assert!(nook.contains("\"$runner\" \"$wasm\" manager::\n"));
    assert!(nook.contains("\"$runner\" \"$wasm\" --skip manager::\n"));
    let partitions = product
        .split_once("FROM builder-nook-wasm-browser-input AS builder-nook-wasm-browser-manager")
        .and_then(|(_, tail)| {
            tail.split_once("FROM builder-nook-wasm-node-compiler AS builder-wasm-node-compiler")
        })
        .map(|(stages, _)| stages)
        .context("browser partitions must join before the public compiler stage")?;
    assert!(!partitions.contains("--mount="));
    for partition in ["manager", "rest"] {
        let copy = format!(
            "COPY --from=builder-nook-wasm-browser-{partition} /opt/nook/wasm-browser-profiles/{partition}-*.profraw ./target/llvm-cov-target/"
        );
        assert!(partitions.contains(&copy));
        assert!(
            partitions.find(&copy)
                < partitions.find("RUN bash /opt/nook/wasm-nook-verify.sh report")
        );
    }
    assert!(
        nook.find("llvm-cov report --target") < nook.find("touch /opt/nook/wasm-coverage-passed")
    );
    assert!(!nook.contains("llvm-cov clean") && !nook.contains("llvm-cov test --no-run"));
    Ok(())
}

#[test]
fn terminal_native_coverage_cleanup_preserves_reports_and_failure_gates() -> anyhow::Result<()> {
    let root = repository_root()?;
    let product = read(&root.join("nook-app/nook-platform/docker/rust/base/Dockerfile"))?;
    let native = product
        .split_once("FROM builder-core-deps AS builder-debug")
        .and_then(|(_, tail)| tail.split_once("FROM scratch AS coverage-export"))
        .map(|(stage, _)| stage)
        .context("native coverage stage must exist")?;
    let runs = DockerfileRunInstruction::parse_stage(native);
    let terminal = runs
        .last()
        .context("native coverage must have a terminal RUN")?;
    let cleanup = "&& rm -rf target/llvm-cov-target";
    assert_eq!(product.matches(cleanup).count(), 1);
    assert!(terminal.ends_with(cleanup));
    assert_eq!(
        terminal.lines().rev().nth(1),
        Some("&& nook-sccache-report --finish native-core-coverage \\")
    );
    for required in [
        "&& cargo llvm-cov nextest --no-clean --profile ci -p nook-core",
        "&& test \"$coverage_status\" -eq 0",
        "/opt/nook/coverage/nook-core/summary.txt",
        "/opt/nook/coverage/nook-core/summary.json",
        "/opt/nook/coverage/nook-core/lcov.info",
        "&& cp nook-core/coverage-floor.json /opt/nook/coverage/nook-core/coverage-floor.json",
    ] {
        let position = terminal.find(required).context(required.to_owned())?;
        assert!(position < terminal.find(cleanup).context("cleanup must exist")?);
    }
    assert_eq!(native.matches("rm -rf").count(), 1);
    for handoff in [
        "COPY --from=builder-debug /opt/nook/coverage/nook-core/ /",
        "COPY --from=builder-debug /opt/nook/coverage /coverage",
    ] {
        assert!(product.contains(handoff));
    }
    Ok(())
}

fn repository_root() -> anyhow::Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .context("preflight manifest must have a repository parent")
}
fn read(path: &Path) -> anyhow::Result<String> {
    fs::read_to_string(path).with_context(|| format!("read {}", path.display()))
}
struct DockerfileRunInstruction {
    text: String,
}

impl DockerfileRunInstruction {
    fn parse_stage(stage: &str) -> Vec<Self> {
        let mut runs = Vec::new();
        let mut lines = stage.lines();
        while let Some(line) = lines.next() {
            let trimmed = line.trim();
            match trimmed.split_whitespace().next() {
                Some("RUN") => (),
                Some(_) | None => continue,
            }
            runs.push(
                Self {
                    text: trimmed.to_owned(),
                }
                .complete(&mut lines),
            );
        }
        runs
    }

    fn preflight_fixture_coverage(dockerfile: &str) -> anyhow::Result<Self> {
        let (_, after_test) = dockerfile
            .split_once("\nFROM build AS test\n")
            .context("preflight must retain its actual test stage")?;
        let (test_stage, _) = after_test
            .split_once("\nFROM ")
            .context("preflight test stage must end before its policy siblings")?;
        Self::parse_stage(test_stage)
            .into_iter()
            .find(|run| run.contains("compiler_fixture_floor="))
            .context("the actual preflight test stage must run the fixture floor decision")
    }

    fn require_fixture_floor(&self) -> anyhow::Result<()> {
        let mut steps = self.text.split(" \\\n&& ");
        let floor_assignment = steps
            .find(|step| step.starts_with("compiler_fixture_floor="))
            .context("fixture floor assignment must be reached through &&")?;
        anyhow::ensure!(
            floor_assignment
                == r#"compiler_fixture_floor="$(jq -er '.package_lines_percent["nook-compiler-cache-proof"] | numbers' /meta-secret/nook/nook-app/nook-platform/nook-core/coverage-floor.json)""#,
            "fixture must read its own floor from the central coverage registry"
        );
        let command = steps
            .next()
            .context("fixture coverage must follow its floor assignment through &&")?;
        let (targets, arguments) = command
            .split_once(" cargo llvm-cov test ")
            .context("fixture coverage must invoke llvm-cov test")?;
        anyhow::ensure!(
            targets
                == "CARGO_TARGET_DIR=/meta-secret/compiler-cache-target CARGO_LLVM_COV_TARGET_DIR=/meta-secret/compiler-cache-target/llvm-cov-target",
            "fixture coverage must use its own Cargo and instrumented target directories"
        );
        let arguments = arguments.split_whitespace().collect::<Vec<_>>();
        let [
            "--offline",
            "--locked",
            "--manifest-path",
            manifest,
            "-p",
            package,
            "--fail-under-lines",
            floor_argument,
            "--no-fail-fast",
        ] = arguments.as_slice()
        else {
            bail!("fixture coverage must keep all test targets and direct floor failure semantics");
        };
        anyhow::ensure!(
            *manifest == "/meta-secret/nook/infra/sim/compiler-cache/Cargo.toml",
            "fixture coverage must select the actual fixture manifest"
        );
        anyhow::ensure!(
            *package == "nook-compiler-cache-proof",
            "fixture coverage must select its own package"
        );
        anyhow::ensure!(
            *floor_argument == "\"$compiler_fixture_floor\"",
            "fixture coverage must enforce its own floor value"
        );
        anyhow::ensure!(
            steps.next().is_some(),
            "fixture failure must propagate to the following && step"
        );
        Ok(())
    }

    #[must_use]
    fn complete(mut self, lines: &mut Lines<'_>) -> Self {
        while let Some('\\') = self.text.chars().last() {
            let Some(line) = lines.next() else {
                break;
            };
            self.text.push('\n');
            self.text.push_str(line.trim());
        }
        self
    }
}

impl Deref for DockerfileRunInstruction {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        &self.text
    }
}

struct WasmCoverageHandoff<'a> {
    source: &'a str,
}

impl WasmCoverageHandoff<'_> {
    const WORKSPACE_CLEANUP: &str = concat!(
        "RUN RUSTC_WRAPPER= cargo +\"${WASM_COVERAGE_NIGHTLY}\" clean --offline --locked --workspace --release --target-dir target/llvm-cov-target \\\n",
        "&& RUSTC_WRAPPER= cargo +\"${WASM_COVERAGE_NIGHTLY}\" clean --offline --locked --workspace --release --target-dir target/llvm-cov-target --target wasm32-unknown-unknown",
    );

    fn require_compiler_wrapper(&self) -> anyhow::Result<()> {
        let mut cleanup_assignments = 0;
        for run in DockerfileRunInstruction::parse_stage(self.source)
            .into_iter()
            .filter(|run| run.contains("RUSTC_WRAPPER="))
        {
            anyhow::ensure!(
                run.text == Self::WORKSPACE_CLEANUP,
                "only the exact mount-free host/WASM workspace cleanup RUN may disable the wrapper"
            );
            cleanup_assignments += run.matches("RUSTC_WRAPPER=").count();
        }
        anyhow::ensure!(
            self.source.matches("RUSTC_WRAPPER=").count() == cleanup_assignments,
            "wrapper assignments outside the approved cleanup RUN are prohibited"
        );
        Ok(())
    }
}

#[test]
fn fixture_coverage_decision_rejects_unbound_or_unreachable_commands() {
    let floor = r#"compiler_fixture_floor="$(jq -er '.package_lines_percent["nook-compiler-cache-proof"] | numbers' /meta-secret/nook/nook-app/nook-platform/nook-core/coverage-floor.json)""#;
    let command = "CARGO_TARGET_DIR=/meta-secret/compiler-cache-target CARGO_LLVM_COV_TARGET_DIR=/meta-secret/compiler-cache-target/llvm-cov-target cargo llvm-cov test --offline --locked --manifest-path /meta-secret/nook/infra/sim/compiler-cache/Cargo.toml -p nook-compiler-cache-proof --fail-under-lines \"$compiler_fixture_floor\" --no-fail-fast";
    let run = format!("RUN true \\\n&& {floor} \\\n&& {command} \\\n&& true");
    let dockerfile = format!("\nFROM build AS test\n{run}\nFROM deps AS policy-tools\n");
    let commented_run = run
        .lines()
        .map(|line| format!("# {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    for rejected in [
        dockerfile.replace(
            ".package_lines_percent[\"nook-compiler-cache-proof\"]",
            ".package_lines_percent[\"nook-preflight\"]",
        ),
        dockerfile.replace("\"$compiler_fixture_floor\"", "\"$floor\""),
        dockerfile.replace(
            "--manifest-path /meta-secret/nook/infra/sim/compiler-cache/Cargo.toml",
            "--manifest-path /meta-secret/nook/preflight/Cargo.toml",
        ),
        dockerfile.replace("-p nook-compiler-cache-proof", "-p nook-preflight"),
        dockerfile.replace(
            "CARGO_TARGET_DIR=/meta-secret/compiler-cache-target",
            "CARGO_TARGET_DIR=/meta-secret/preflight-target",
        ),
        dockerfile.replace(
            "CARGO_LLVM_COV_TARGET_DIR=/meta-secret/compiler-cache-target/llvm-cov-target",
            "CARGO_LLVM_COV_TARGET_DIR=/meta-secret/preflight-target/llvm-cov-target",
        ),
        dockerfile.replace("&& CARGO_TARGET_DIR=", "; CARGO_TARGET_DIR="),
        dockerfile.replace("&& true", "; true"),
        dockerfile.replace("FROM build AS test", "FROM build AS unused-tests"),
        dockerfile.replace(run.as_str(), &commented_run),
    ] {
        assert!(
            DockerfileRunInstruction::preflight_fixture_coverage(&rejected)
                .and_then(|run| run.require_fixture_floor())
                .is_err(),
            "fixture floor must stay bound to the actual failing test RUN: {rejected}"
        );
    }
}

#[test]
fn coverage_handoff_allows_only_exact_metadata_cleanup() -> anyhow::Result<()> {
    let source = format!(
        "{}\nRUN cargo llvm-cov test --no-clean --release -p nook-wasm",
        WasmCoverageHandoff::WORKSPACE_CLEANUP
    );
    WasmCoverageHandoff { source: &source }.require_compiler_wrapper()?;
    WasmCoverageHandoff {
        source: "RUN cargo clippy --release -- -D warnings",
    }
    .require_compiler_wrapper()?;
    Ok(())
}

#[test]
fn coverage_handoff_rejects_wrapper_bypass_and_cleanup_expansion() {
    let cleanup = WasmCoverageHandoff::WORKSPACE_CLEANUP;
    for source in [
        cleanup.replace("clean --offline", "build --offline"),
        cleanup.replace("clean --offline", "test --offline"),
        cleanup.replace("clean --offline", "clippy --offline"),
        cleanup.replace("--workspace", "-p nook-wasm"),
        format!("{cleanup} \\\n&& cargo build --release"),
        format!("{cleanup} \\\n&& cat /run/secrets/sccache_s3_access_key"),
        cleanup.replacen(
            "RUN ",
            "RUN --mount=type=secret,id=sccache_s3_access_key ",
            1,
        ),
        format!("ENV RUSTC_WRAPPER=\n{cleanup}"),
        format!("{cleanup}\nRUN RUSTC_WRAPPER= cargo build --release"),
    ] {
        assert!(
            WasmCoverageHandoff { source: &source }
                .require_compiler_wrapper()
                .is_err(),
            "wrapper bypass must remain rejected: {source}"
        );
    }
}

struct WasmSourceOverlay<'a> {
    declaration: &'a str,
    packages: &'a [&'a str],
    refresh: &'a str,
}

impl WasmSourceOverlay<'_> {
    fn require_fresh_sources(&self, dockerfile: &str) -> anyhow::Result<()> {
        let (_, tail) = dockerfile
            .split_once(self.declaration)
            .context("source overlay stage must exist")?;
        let (stage, _) = tail
            .split_once("\nFROM ")
            .context("source overlay must end before the next stage")?;
        let refresh = stage
            .find(self.refresh)
            .context("source overlay must refresh every Rust file in its copied packages")?;
        for package in self.packages {
            let copy = stage
                .rfind(&format!("COPY nook-app/nook-platform/{package} {package}"))
                .with_context(|| format!("source overlay must copy {package}"))?;
            anyhow::ensure!(copy < refresh, "{package} must be copied before refreshing");
        }
        if let Some(compiler) = stage.find("cargo ") {
            anyhow::ensure!(refresh < compiler, "source refresh must precede Cargo use");
        }
        Ok(())
    }
}

#[test]
fn wasm_source_overlays_refresh_all_rust_files_before_compilation() -> anyhow::Result<()> {
    let root = repository_root()?;
    let dockerfile = read(&root.join("nook-app/nook-platform/docker/rust/base/Dockerfile"))?;
    for overlay in [
        WasmSourceOverlay {
            declaration: "FROM builder-wasm-deps AS builder-wasm-source-base",
            packages: &[
                "nook-app-common",
                "nook-authenticator-domain",
                "nook-auth2",
                "nook-replication",
                "nook-event-log",
                "nook-companion-core",
                "nook-core",
            ],
            refresh: "find nook-app-common nook-authenticator-domain nook-auth2 nook-replication nook-event-log nook-companion-core nook-core -type f -name '*.rs' -exec touch {} +",
        },
        WasmSourceOverlay {
            declaration: "FROM builder-wasm-source-base AS builder-wasm-source\n",
            packages: &["nook-companion-wasm", "nook-wasm"],
            refresh: "find nook-companion-wasm nook-wasm -type f -name '*.rs' -exec touch {} +",
        },
        WasmSourceOverlay {
            declaration: "FROM builder-wasm-source-base AS builder-nook-wasm-source",
            packages: &["nook-wasm"],
            refresh: "find nook-wasm -type f -name '*.rs' -exec touch {} +",
        },
        WasmSourceOverlay {
            declaration: "FROM builder-wasm-source-base AS builder-companion-wasm-source",
            packages: &["nook-companion-wasm"],
            refresh: "find nook-companion-wasm -type f -name '*.rs' -exec touch {} +",
        },
    ] {
        overlay.require_fresh_sources(&dockerfile)?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct CoveragePolicy {
    lines_percent: f64,
    enforced_packages: BTreeSet<String>,
    excluded_packages: Vec<ExcludedPackage>,
    package_lines_percent: BTreeMap<String, f64>,
}
#[derive(Deserialize)]
struct ExcludedPackage {
    package: String,
    reason: String,
}
impl CoveragePolicy {
    fn read(path: &Path) -> anyhow::Result<Self> {
        serde_json::from_str(&read(path)?).with_context(|| format!("parse {}", path.display()))
    }
}
fn discover_packages(root: &Path) -> anyhow::Result<BTreeMap<String, PathBuf>> {
    let mut manifests = Vec::new();
    collect_manifests(root, &mut manifests)?;
    let mut packages = BTreeMap::new();
    for manifest in manifests {
        let contents = read(&manifest)?;
        let Some(package_section) = contents.split_once("[package]").map(|(_, rest)| rest) else {
            continue;
        };
        let section = package_section
            .split_once("\n[")
            .map_or(package_section, |(current, _)| current);
        let name = section.lines().find_map(|line| {
            line.trim()
                .strip_prefix("name = ")
                .map(|value| value.trim_matches('"').to_owned())
        });
        let Some(name) = name else {
            bail!("package manifest lacks a name: {}", manifest.display());
        };
        if let Some(previous) = packages.insert(name.clone(), manifest.clone()) {
            bail!(
                "duplicate package name {name}: {} and {}",
                previous.display(),
                manifest.display()
            );
        }
    }
    Ok(packages)
}
fn collect_manifests(directory: &Path, output: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    for entry in fs::read_dir(directory).with_context(|| format!("read {}", directory.display()))? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            let name = entry.file_name();
            if name != ".git" && name != "target" && name != "node_modules" {
                collect_manifests(&path, output)?;
            }
        } else if entry.file_name() == "Cargo.toml" {
            output.push(path);
        }
    }
    Ok(())
}
