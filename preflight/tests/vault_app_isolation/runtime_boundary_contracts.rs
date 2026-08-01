use super::*;

#[test]
fn vault_apps_keep_rust_owned_runtime_boundaries() {
    let root = repository_root();
    let sentinel_config = read(
        &root,
        "nook-app/nook-web/nook-vault-sentinel/vite.config.ts",
    );
    assert!(!sentinel_config.contains("__NOOK_APP_KIND__"));
    let recognizes_pathname = sentinel_config.contains("pathname ===");
    let recognizes_extension_connect = sentinel_config.contains("/extension-connect");
    assert!(recognizes_pathname && recognizes_extension_connect);
    assert!(!sentinel_config.contains("extension-connect.html"));

    let simple_config = read(&root, "nook-app/nook-web/nook-vault-simple/vite.config.ts");
    assert!(!simple_config.contains("__NOOK_APP_KIND__"));
    assert!(simple_config.contains("extension-connect"));

    let wasm_bridge = read(
        &root,
        "nook-app/nook-web/nook-web-shared/src/vault-app/lib/wasm-bootstrap.ts",
    );
    assert!(wasm_bridge.contains("configureVaultApplication(application)"));
    let wasm_vault_api = read(&root, "nook-app/nook-wasm/src/vault_api.rs");
    for rust_owned_api in [
        "application: nook_core::VaultApplication",
        "-> nook_core::VaultApplication",
        "configuredVaultApplicationSupportsExtension",
        "configuredVaultApplicationIsSimple",
        "configuredVaultApplicationIsSentinel",
        "simpleVaultAppUrl",
        "pendingVaultCreationResumesAutomatically",
    ] {
        assert!(wasm_vault_api.contains(rust_owned_api));
    }
    assert!(!wasm_vault_api.contains("application_name: &str"));
    for retired_typescript_module in ["app-kind.ts", "app-lifecycle-state.ts"] {
        assert!(
            !root
                .join("nook-app/nook-web/nook-web-shared/src/vault-app/lib")
                .join(retired_typescript_module)
                .exists()
        );
    }
    let vault_operation = read(&root, "nook-app/nook-core/src/vault/vault_operation.rs");
    assert!(vault_operation.contains("pub enum DeviceProtectedOperationState"));
    assert!(vault_operation.contains("pub enum PendingVaultCreationKind"));

    let shared_entry = read(
        &root,
        "nook-app/nook-web/nook-web-shared/src/vault-app/main.ts",
    );
    assert!(shared_entry.contains("await ensureAppWasm(expectedKind)"));
    assert!(shared_entry.contains("await import("));
    for (entry, expected_kind) in [
        (
            "nook-app/nook-web/nook-vault-simple/src/main.ts",
            "mountVaultApp(VaultApplication.Simple)",
        ),
        (
            "nook-app/nook-web/nook-vault-sentinel/src/main.ts",
            "mountVaultApp(VaultApplication.Sentinel)",
        ),
    ] {
        assert!(read(&root, entry).contains(expected_kind));
    }

    let dockerignore = read(&root, ".dockerignore");
    assert!(
        dockerignore.contains("nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm*")
    );
    assert!(
        dockerignore
            .contains("nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm*")
    );
    for ignored in [
        "**/target",
        "**/node_modules",
        "**/dist",
        "**/test-results",
        "**/playwright-report",
        "**/coverage",
    ] {
        assert!(dockerignore.lines().any(|line| line == ignored));
    }
}
