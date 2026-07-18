use std::path::PathBuf;

use nook_preflight::{
    portable_core_browser_dependencies, rust_wasm_domain_boundary_escape_hatches,
    typescript_domain_boundary_boilerplate,
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

#[test]
fn portable_core_does_not_import_browser_runtime_crates() {
    let violations = portable_core_browser_dependencies(&repository_root())
        .expect("scan portable core dependencies");
    assert!(
        violations.is_empty(),
        "nook-core must stay browser-independent: {violations:#?}"
    );
}

#[test]
fn typescript_domain_boundary_stays_generated_and_direct() {
    let violations = typescript_domain_boundary_boilerplate(&repository_root())
        .expect("scan TypeScript domain boundary");
    assert!(
        violations.is_empty(),
        "vault domain schemas belong in Rust; use generated WASM types and direct exports instead of TypeScript mirrors or forwarding wrappers: {violations:#?}"
    );
}

#[test]
fn rust_wasm_domain_boundary_stays_real_and_typed() {
    let violations = rust_wasm_domain_boundary_escape_hatches(&repository_root())
        .expect("scan Rust WASM domain boundary");
    assert!(
        violations.is_empty(),
        "WASM domain DTOs must use real Rust ABI types; unchecked TypeScript hints and raw provider/auth JsValue signatures are forbidden: {violations:#?}"
    );
}
