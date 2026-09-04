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
    let classified = enforced
        .union(&excluded_names)
        .cloned()
        .collect::<BTreeSet<_>>();

    assert_eq!(
        discovered.keys().cloned().collect::<BTreeSet<_>>(),
        classified,
        "every Cargo package must be independently enforced or explicitly excluded"
    );
    assert!(enforced.is_disjoint(&excluded_names));
    assert!(
        policy["lines_percent"]
            .as_f64()
            .is_some_and(|floor| (floor - 90.0).abs() < f64::EPSILON)
    );
    assert_eq!(
        excluded.get("nook-fuzz").map(String::as_str),
        Some(
            "Intentional non-testable cargo-fuzz harness; covered behavior belongs to nook-auth2."
        )
    );
    assert_eq!(
        excluded.get("arrayref").map(String::as_str),
        Some(
            "Vendored third-party patch; upstream source is outside Nook's authored coverage policy."
        )
    );
    Ok(())
}

#[test]
fn every_enforced_package_has_an_independent_hosted_failure_decision() -> anyhow::Result<()> {
    let root = repository_root()?;
    let product = read(&root.join("nook-app/nook-platform/docker/rust/product.Dockerfile"))?;
    let platform_tasks = read(&root.join("nook-app/nook-platform/Taskfile.yml"))?;
    let hive = read(&root.join("agentic-ai/minds/hive/Dockerfile"))?;
    let preflight = read(&root.join("preflight/Dockerfile"))?;
    let minds_manifest = read(&root.join("agentic-ai/minds/Cargo.toml"))?;
    let fuzz_manifest = read(&root.join("nook-app/nook-platform/fuzz/Cargo.toml"))?;

    let portable = "nook-app-common nook-authenticator-domain nook-auth2 nook-replication nook-event-log nook-companion-core nook-core";
    assert!(product.contains(&format!("for package in {portable}; do")));
    assert!(platform_tasks.contains(&format!("packages=\"{portable}\"")));
    assert!(product.contains(
        "cargo llvm-cov report -p \"$package\" --summary-only --fail-under-lines \"$FLOOR\""
    ));
    assert!(platform_tasks.contains(
        "cargo llvm-cov report -p \"$package\" --summary-only --fail-under-lines {{.FLOOR}}"
    ));

    assert!(product.contains("for package in nook-companion-wasm nook-wasm; do"));
    assert!(product.contains("cargo +\"${WASM_COVERAGE_NIGHTLY}\" llvm-cov test"));
    assert!(product.contains("--target wasm32-unknown-unknown --release -p \"$package\""));
    assert!(product.contains("--fail-under-lines \"$floor\""));
    assert!(product.contains("wasm-pack test --node --release nook-wasm"));
    assert!(product.contains("wasm-pack test --node --release nook-companion-wasm"));

    assert!(hive.contains("for package in hive lace; do"));
    assert!(hive.contains("ARG RUST_COVERAGE_FLOOR=90"));
    assert!(hive.contains("cargo llvm-cov test --locked -p \"$package\""));
    assert!(hive.contains("--fail-under-lines \"${RUST_COVERAGE_FLOOR}\""));
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
    assert!(preflight.contains(
        "floor=\"$(jq -r '.lines_percent' /meta-secret/nook/nook-app/nook-platform/nook-core/coverage-floor.json)\""
    ));
    assert!(preflight.contains(
        "COPY --from=build /meta-secret/preflight-target/debug/nook-preflight /nook-preflight"
    ));
    assert!(!preflight.contains("/meta-secret/nook/preflight/target"));
    assert!(!preflight.contains("/opt/nook/preflight"));
    assert!(!preflight.contains("/opt/nook/coverage-floor.json"));

    assert!(minds_manifest.contains("exclude = [\"vendor/arrayref\"]"));
    assert!(fuzz_manifest.contains("cargo-fuzz = true"));
    assert!(fuzz_manifest.contains("test = false"));
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
