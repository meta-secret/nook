use anyhow::{Context, bail};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

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
    let compiler_runs = dockerfile_run_instructions(wasm_node_deps)
        .into_iter()
        .filter(|run| run.contains("--no-run"))
        .collect::<Vec<_>>();
    assert_eq!(compiler_runs.len(), 2);
    assert!(compiler_runs[0].contains("llvm-cov show-env --sh"));
    assert!(!compiler_runs[0].contains("--target wasm32-unknown-unknown"));
    assert!(compiler_runs[1].contains("llvm-cov show-env --sh --target wasm32-unknown-unknown"));
    assert!(compiler_runs[1].contains("--target wasm32-unknown-unknown"));
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
    assert!(!handoff.contains("RUSTC_WRAPPER="));
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
    let runs = dockerfile_run_instructions(native);
    let terminal = runs
        .last()
        .context("native coverage must have a terminal RUN")?;
    let cleanup = "&& rm -rf target/llvm-cov-target";
    assert_eq!(product.matches(cleanup).count(), 1);
    assert!(terminal.ends_with(cleanup));
    assert_eq!(
        terminal.lines().rev().nth(1),
        Some("&& nook-sccache-report native-core-coverage \\")
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
fn dockerfile_run_instructions(stage: &str) -> Vec<String> {
    let mut runs = Vec::new();
    let mut current: Option<String> = None;
    for line in stage.lines() {
        let trimmed = line.trim();
        if let Some(run) = current.as_mut() {
            run.push('\n');
            run.push_str(trimmed);
            if !trimmed.ends_with('\\') {
                runs.push(current.take().expect("RUN instruction must be present"));
            }
            continue;
        }
        let Some(rest) = trimmed.strip_prefix("RUN") else {
            continue;
        };
        if !rest.is_empty() && !rest.chars().next().is_some_and(char::is_whitespace) {
            continue;
        }
        let instruction = trimmed.to_owned();
        if trimmed.ends_with('\\') {
            current = Some(instruction);
        } else {
            runs.push(instruction);
        }
    }
    if let Some(run) = current {
        runs.push(run);
    }
    runs
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
