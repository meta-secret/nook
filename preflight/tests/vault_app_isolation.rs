use std::{
    fs,
    path::{Path, PathBuf},
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn read(root: &Path, path: &str) -> String {
    fs::read_to_string(root.join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

#[test]
fn production_vault_apps_are_separate_compile_time_capabilities() {
    let root = repository_root();
    for project in ["nook-vault-simple", "nook-vault-sentinel"] {
        assert!(
            root.join("nook-app/nook-web")
                .join(project)
                .join("package.json")
                .is_file(),
            "{project} must remain an independent web project"
        );
    }

    let wasm_manifest = read(&root, "nook-app/nook-wasm/Cargo.toml");
    for feature in [
        "app-simple",
        "app-sentinel",
        "app-extension",
        "app-legacy-migration",
    ] {
        assert!(
            wasm_manifest.contains(feature),
            "missing WASM capability {feature}"
        );
    }
    let application = read(&root, "nook-app/nook-wasm/src/application.rs");
    assert!(application.contains("features are mutually exclusive"));

    let sentinel_config = read(
        &root,
        "nook-app/nook-web/nook-vault-sentinel/vite.config.ts",
    );
    assert!(sentinel_config.contains("nook-wasm-sentinel"));
    assert!(
        sentinel_config.contains("pathname ===") && sentinel_config.contains("/extension-connect")
    );
    assert!(!sentinel_config.contains("extension-connect.html"));

    let simple_config = read(&root, "nook-app/nook-web/nook-vault-simple/vite.config.ts");
    assert!(simple_config.contains("nook-wasm-simple"));
    assert!(simple_config.contains("extension-connect"));
}

#[test]
fn extension_and_release_contract_preserve_origin_isolation() {
    let root = repository_root();
    let manifest = read(
        &root,
        "nook-app/nook-web/nook-web-extension/src/manifest.ts",
    );
    assert!(manifest.contains("https://simple.nokey.sh/*"));
    assert!(manifest.contains("exclude_matches: ['https://sentinel.nokey.sh/*']"));

    let release = read(&root, ".github/workflows/release.yml");
    for required in [
        "nook-vault-simple/dist",
        "nook-vault-sentinel/dist",
        "simple.nokey.sh:nokey-simple",
        "sentinel.nokey.sh:nokey-sentinel",
        "nook-app-kind",
    ] {
        assert!(
            release.contains(required),
            "release workflow missing {required}"
        );
    }
}
