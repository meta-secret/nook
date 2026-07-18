use std::path::PathBuf;

use nook_preflight::{portable_core_browser_dependencies, typescript_domain_schema_mirrors};

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
fn removed_typescript_domain_mirrors_do_not_return() {
    let violations =
        typescript_domain_schema_mirrors(&repository_root()).expect("scan TypeScript schemas");
    assert!(
        violations.is_empty(),
        "vault domain schemas belong in Rust and typed WASM wrappers: {violations:#?}"
    );
}
