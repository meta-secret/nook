use anyhow::{Context, bail};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
#[test]
fn every_rust_package_has_an_explicit_coverage_policy() -> anyhow::Result<()> {
    let root = repository_root()?;
    let policy = read_json(&root.join("nook-app/nook-platform/nook-core/coverage-floor.json"))?;
    let enforced = string_set(&policy, "enforced_packages")?;
    let excluded = excluded_packages(&policy)?;
    let excluded_names = excluded.keys().cloned().collect::<BTreeSet<_>>();
    let discovered = discover_packages(&root)?;
    let classified: BTreeSet<_> = enforced.union(&excluded_names).cloned().collect();
    assert_eq!(
        discovered.keys().cloned().collect::<BTreeSet<_>>(),
        classified,
        "every Cargo package must be independently enforced or explicitly excluded"
    );
    assert!(enforced.is_disjoint(&excluded_names));
    let policy_floor = policy["lines_percent"].as_f64();
    assert!(policy_floor.is_some_and(|floor| floor >= 90.0));
    let package_floors = policy["package_lines_percent"]
        .as_object()
        .context("package_lines_percent must be an object")?;
    assert_eq!(
        package_floors.keys().cloned().collect::<BTreeSet<_>>(),
        enforced,
        "every enforced package must have an explicit coverage entry"
    );
    for (package, floor) in package_floors {
        let expected = match package.as_str() {
            "nook-wasm" => 51.0,
            "nook-companion-wasm" => 18.0,
            "nook-authenticator-domain" => 87.0,
            "hive" => 60.0,
            "lace" => 75.0,
            _ => 90.0,
        };
        assert!(floor.as_f64().is_some_and(|floor| floor >= expected));
    }
    assert_eq!(
        excluded["nook-fuzz"],
        "Intentional non-testable cargo-fuzz harness; covered behavior belongs to nook-auth2."
    );
    assert_eq!(
        excluded["arrayref"],
        "Vendored third-party patch; upstream source is outside Nook's authored coverage policy."
    );
    Ok(())
}
#[test]
fn every_enforced_package_has_an_independent_hosted_failure_decision() -> anyhow::Result<()> {
    let root = repository_root()?;
    let product = read(&root.join("nook-app/nook-platform/docker/rust/product.Dockerfile"))?;
    let nightly = read(&root.join("nook-app/nook-platform/docker/rust/nightly.Dockerfile"))?;
    let docker_tasks = read(&root.join("nook-app/nook-platform/docker/Taskfile.yml"))?;
    let platform_tasks = read(&root.join("nook-app/nook-platform/Taskfile.yml"))?;
    let hive = read(&root.join("agentic-ai/minds/hive/Dockerfile"))?;
    let hive_tasks = read(&root.join("agentic-ai/minds/hive/Taskfile.yml"))?;
    let hive_arc = read(&root.join("agentic-ai/minds/hive/run-arc-tests.sh"))?;
    let preflight = read(&root.join("preflight/Dockerfile"))?;
    let minds_manifest = read(&root.join("agentic-ai/minds/Cargo.toml"))?;
    let fuzz_manifest = read(&root.join("nook-app/nook-platform/fuzz/Cargo.toml"))?;
    let policy = read_json(&root.join("nook-app/nook-platform/nook-core/coverage-floor.json"))?;
    let enforced = string_set(&policy, "enforced_packages")?;
    for package in &enforced {
        assert!(
            [&product, &nightly, &platform_tasks, &hive, &preflight]
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
    assert!(
        nightly
            .contains("dylint/nook-domain-api/target/debug/libnook_domain_api@${toolchain_id}.so")
    );
    assert!(nightly.contains("ARG RUST_DYLINT_COVERAGE_FLOOR"));
    assert!(nightly.contains("--fail-under-lines \"${RUST_DYLINT_COVERAGE_FLOOR:?}\""));
    assert!(docker_tasks.contains(".package_lines_percent[\"nook_domain_api\"] | numbers"));
    assert!(docker_tasks.matches("RUST_DYLINT_COVERAGE_FLOOR=").count() == 2);
    assert!(nightly.contains("target/llvm-cov-target/debug/libnook_domain_api-c0ffee.so"));
    assert!(product.contains(".package_lines_percent[\"nook-companion-wasm\"]"));
    assert!(product.contains("llvm-cov clean --workspace"));
    assert!(product.contains("llvm-cov test --release -p nook-wasm --no-report"));
    assert!(product.contains("CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=true"));
    assert_eq!(product.matches("--features browser-wasm-tests").count(), 2);
    assert!(product.contains(
        "llvm-cov test --no-clean --target wasm32-unknown-unknown --release -p nook-wasm"
    ));
    assert!(product.contains(".package_lines_percent[\"nook-wasm\"]"));
    assert!(product.contains("--fail-under-lines \"$nook_wasm_floor\""));
    let wasm_coverage_stage = product
        .split_once("FROM builder-wasm-tests AS builder-wasm")
        .and_then(|(_, remainder)| {
            remainder
                .split_once("FROM scratch AS wasm-export")
                .map(|(stage, _)| stage)
        })
        .context("builder-wasm must be a bounded product image stage")?;
    assert!(wasm_coverage_stage.contains("apt-get install -y --no-install-recommends clang"));
    assert!(wasm_coverage_stage.contains("native=82 browser=147"));
    assert!(wasm_coverage_stage.contains("sha256sum -c -"));
    assert!(wasm_coverage_stage.contains(
        "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS=\"-Zno-profiler-runtime -Clink-args=--no-gc-sections --cfg=wasm_bindgen_unstable_test_coverage\""
    ));
    let browser_execution = wasm_coverage_stage
        .split_once("\nRUN curl -fsSL https://bun.sh/install")
        .context("secret-free browser install and execution RUN")?
        .1;
    assert!(!browser_execution.contains("--mount=type=secret"));
    assert!(hive_tasks.contains(".package_lines_percent.hive | numbers"));
    assert!(hive_tasks.contains(".package_lines_percent.lace | numbers"));
    assert!(hive.contains("cargo llvm-cov report -p hive"));
    assert!(hive.contains("--fail-under-lines \"${HIVE_RUST_COVERAGE_FLOOR}\""));
    assert!(hive.contains("cargo llvm-cov report -p lace"));
    assert!(hive.contains("--fail-under-lines \"${LACE_RUST_COVERAGE_FLOOR}\""));
    assert!(hive.contains("coverage_status=0;") && !hive.contains("ARG RUST_COVERAGE_FLOOR="));
    assert_eq!(hive.matches("|| coverage_status=1;").count(), 2);
    assert!(hive.contains("test \"$coverage_status\" -eq 0"));
    assert!(hive.contains(
        "ARG LLVM_COV_SHA256=9a75fe29538d3800b3da57f6f6efb64cba5c720a257bf0cb8b51f39d495a9168"
    ));
    assert!(hive.contains("sha256sum -c -"));
    assert!(hive.contains("cargo llvm-cov show-env --export-prefix"));
    assert!(hive.contains("CARGO_TARGET_DIR=target/llvm-cov-target cargo test"));
    assert!(hive.contains("COPY --from=hive-coverage-profiles"));
    assert!(hive.contains("mkdir -p target/llvm-cov-target"));
    assert!(hive_tasks.contains("hive-coverage-profiles=$profiles"));
    assert!(hive_tasks.contains("LLVM_PROFILE_FILE=/profiles/%m-%p.profraw"));
    assert!(hive_arc.contains("LLVM_PROFILE_FILE=%q exec %q"));
    assert!(
        preflight.contains(
            "cargo llvm-cov test --locked -p nook-preflight --fail-under-lines \"$floor\""
        )
    );
    assert!(preflight.contains("WORKDIR /meta-secret/nook/preflight"));
    assert_eq!(
        preflight
            .matches("ENV CARGO_TARGET_DIR=/meta-secret/preflight-target")
            .count(),
        2,
        "chef and dependency roots must keep generated Cargo output outside repository source"
    );
    assert!(preflight.contains("ENV NOOK_REPO_ROOT=/meta-secret/nook"));
    assert!(preflight.contains(".package_lines_percent[\"nook-preflight\"] | numbers"));
    assert!(preflight.contains(
        "COPY --from=build /meta-secret/preflight-target/debug/nook-preflight /nook-preflight"
    ));
    assert!(!preflight.contains("/meta-secret/nook/preflight/target"));
    assert!(!preflight.contains("/opt/nook/preflight"));
    assert!(!preflight.contains("/opt/nook/coverage-floor.json"));
    assert!(minds_manifest.contains("exclude = [\"vendor/arrayref\"]"));
    assert!(fuzz_manifest.contains("cargo-fuzz = true") && fuzz_manifest.contains("test = false"));
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
fn read_json(path: &Path) -> anyhow::Result<Value> {
    serde_json::from_str(&read(path)?).with_context(|| format!("parse {}", path.display()))
}
fn string_set(value: &Value, key: &str) -> anyhow::Result<BTreeSet<String>> {
    value[key]
        .as_array()
        .with_context(|| format!("{key} must be an array"))?
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::to_owned)
                .with_context(|| format!("{key} entries must be strings"))
        })
        .collect()
}
fn excluded_packages(value: &Value) -> anyhow::Result<BTreeMap<String, String>> {
    value["excluded_packages"]
        .as_array()
        .context("excluded_packages must be an array")?
        .iter()
        .map(|entry| {
            let package = entry["package"]
                .as_str()
                .context("excluded package must name a package")?;
            let reason = entry["reason"]
                .as_str()
                .context("excluded package must state a reason")?;
            Ok((package.to_owned(), reason.to_owned()))
        })
        .collect()
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
