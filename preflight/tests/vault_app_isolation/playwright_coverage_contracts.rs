use super::{read, repository_root};
use std::fs;

#[test]
fn every_top_level_playwright_behavior_spec_belongs_to_a_gate() -> anyhow::Result<()> {
    let root = repository_root();
    let e2e_dir = root.join("nook-app/nook-web/nook-web-app/e2e");
    let default_config = read(&root, "nook-app/nook-web/nook-web-app/playwright.config.ts");
    let isolation_config = read(
        &root,
        "nook-app/nook-web/nook-web-app/playwright.isolation.config.ts",
    );

    let mut ungated = Vec::new();
    for entry in fs::read_dir(e2e_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.ends_with(".spec.ts") {
            continue;
        }
        let quoted_name = format!("'{file_name}'");
        if !default_config.contains(&quoted_name) && !isolation_config.contains(&file_name) {
            ungated.push(file_name);
        }
    }

    ungated.sort();
    assert!(
        ungated.is_empty(),
        "top-level Playwright behavior specs must belong to the default or isolation gate: {}",
        ungated.join(", ")
    );
    Ok(())
}
