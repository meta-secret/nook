use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn wasm_source_does_not_use_js_value() -> anyhow::Result<()> {
    let repository_root = std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );

    let violations = nook_preflight::wasm_js_values(&repository_root)?;

    assert!(
        violations.is_empty(),
        "JsValue is prohibited in authored nook-wasm Rust; use a typed wasm-bindgen struct or browser API type instead:\n{}",
        violations
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(())
}

#[test]
fn wasm_callable_names_preserve_rust_provenance_end_to_end() -> anyhow::Result<()> {
    let root = std::env::temp_dir().join(format!(
        "nook-wasm-callable-provenance-{}",
        std::process::id()
    ));
    if root.exists() {
        fs::remove_dir_all(&root)?;
    }
    let rust_root = root.join("nook-app/nook-platform/nook-wasm/src");
    let web_root = root.join("nook-app/nook-web");
    fs::create_dir_all(&rust_root)?;
    fs::create_dir_all(&web_root)?;
    fs::write(
        rust_root.join("lib.rs"),
        r"use wasm_bindgen::prelude::wasm_bindgen as export_wasm;

#[export_wasm]
pub fn generate_secret_id() {}

#[export_wasm]
pub struct NookVaultArchitecture;

#[export_wasm]
impl NookVaultArchitecture {
    pub fn simple() {}
    pub fn connect() {}
}
",
    )?;
    write_web_source(
        &web_root,
        "aliased-attribute.ts",
        r#"import { generate_secret_id as generateSecretId } from "$app-wasm";"#,
    )?;
    write_web_source(
        &web_root,
        "reassignment.ts",
        r#"let client = await import("$app-wasm");
client = socketApi;
const openSocket = client.connect;"#,
    )?;
    write_web_source(
        &web_root,
        "object-property.ts",
        r#"import * as wasm from "$app-wasm";
const api = { generateSecretId: wasm.generate_secret_id };
api.generateSecretId();"#,
    )?;
    write_web_source(
        &web_root,
        "namespace-static.ts",
        r#"import * as wasm from "$app-wasm";
const simpleVault = wasm.NookVaultArchitecture.simple;"#,
    )?;
    write_web_source(
        &web_root,
        "facade.ts",
        r#"export { NookVaultArchitecture } from "$app-wasm";
export { NookVaultManager } from "third-party";"#,
    )?;
    write_web_source(
        &web_root,
        "mixed-facade.ts",
        r#"import { NookVaultManager } from "./facade";
const manager = new NookVaultManager();
const openSocket = manager.connect;"#,
    )?;

    let violations = nook_preflight::rust_wasm_callable_name_overrides(&root)?;
    let locations = violations
        .iter()
        .map(|violation| {
            (
                violation
                    .path
                    .strip_prefix(&root)
                    .unwrap_or(&violation.path),
                violation.line,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        locations,
        vec![
            (Path::new("nook-app/nook-web/aliased-attribute.ts"), 1),
            (Path::new("nook-app/nook-web/namespace-static.ts"), 2),
            (Path::new("nook-app/nook-web/object-property.ts"), 2),
        ]
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

fn write_web_source(root: &Path, name: &str, source: &str) -> anyhow::Result<()> {
    fs::write(root.join(name), source)?;
    Ok(())
}
