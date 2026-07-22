use std::path::PathBuf;

#[test]
fn wasm_source_does_not_use_js_value() {
    let repository_root = std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );

    let violations = nook_preflight::wasm_js_values(&repository_root)
        .expect("the authored nook-wasm source should parse");

    assert!(
        violations.is_empty(),
        "JsValue is prohibited in authored nook-wasm Rust; use a typed wasm-bindgen struct or browser API type instead:\n{}",
        violations
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
}
