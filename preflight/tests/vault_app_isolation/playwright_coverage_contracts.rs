use super::repository_root;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const PLAYWRIGHT_SOURCE_EXTENSIONS: [&str; 8] =
    ["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"];

fn is_playwright_behavior_spec(file_name: &str) -> bool {
    ["spec", "test"].iter().any(|kind| {
        PLAYWRIGHT_SOURCE_EXTENSIONS
            .iter()
            .any(|extension| file_name.ends_with(&format!(".{kind}.{extension}")))
    })
}

fn collect_behavior_specs(
    directory: &Path,
    e2e_directory: &Path,
    specs: &mut BTreeSet<String>,
) -> anyhow::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            if entry.file_name() != "demos" {
                collect_behavior_specs(&path, e2e_directory, specs)?;
            }
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !is_playwright_behavior_spec(file_name) {
            continue;
        }
        specs.insert(
            path.strip_prefix(e2e_directory)?
                .to_string_lossy()
                .into_owned(),
        );
    }
    Ok(())
}

fn manifest_specs(manifest_path: PathBuf) -> anyhow::Result<BTreeSet<String>> {
    let manifest: serde_json::Value = serde_json::from_str(&fs::read_to_string(manifest_path)?)?;
    let gates = manifest
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("Playwright gate manifest must be a JSON object"))?;
    let expected_gates = BTreeSet::from(["isolation", "manual", "stable", "unstable"]);
    let actual_gates = gates.keys().map(String::as_str).collect::<BTreeSet<_>>();
    anyhow::ensure!(
        actual_gates == expected_gates,
        "Playwright gate manifest must define exactly isolation, manual, stable, and unstable"
    );

    let mut specs = BTreeSet::new();
    for (gate, entries) in gates {
        let entries = entries
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Playwright gate {gate} must be an array"))?;
        for entry in entries {
            let spec = entry.as_str().ok_or_else(|| {
                anyhow::anyhow!("Playwright gate {gate} contains a non-string entry")
            })?;
            anyhow::ensure!(
                specs.insert(spec.to_owned()),
                "Playwright behavior spec {spec} belongs to more than one gate"
            );
        }
    }
    Ok(specs)
}

#[test]
fn every_nook_web_app_behavior_spec_belongs_to_exactly_one_gate() -> anyhow::Result<()> {
    let root = repository_root();
    let e2e_directory = root.join("nook-app/nook-web/nook-web-app/e2e");
    let mut discovered = BTreeSet::new();
    collect_behavior_specs(&e2e_directory, &e2e_directory, &mut discovered)?;

    let configured =
        manifest_specs(root.join("nook-app/nook-web/nook-web-app/playwright.gates.json"))?;
    let ungated = discovered.difference(&configured).collect::<Vec<_>>();
    let missing = configured.difference(&discovered).collect::<Vec<_>>();
    assert!(
        ungated.is_empty() && missing.is_empty(),
        "Playwright gate manifest mismatch; ungated: {ungated:?}; missing: {missing:?}"
    );
    Ok(())
}
