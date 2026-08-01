use super::*;

#[test]
fn vault_app_library_root_is_package_oriented() -> anyhow::Result<()> {
    let lib_root = repository_root()
        .join("nook-app/nook-web/nook-web-shared/src/vault-app/lib");
    let mut root_files = fs::read_dir(&lib_root)?
        .map(|entry| entry.map(|value| value.path()))
        .collect::<Result<Vec<_>, _>>()?;
    root_files.retain(|path| path.is_file());
    root_files.sort();

    let mut expected_root_files = ["nook.ts", "utils.ts", "vault.svelte.ts"]
        .map(|name| lib_root.join(name))
        .to_vec();
    expected_root_files.sort();
    assert_eq!(root_files, expected_root_files);

    for package in [
        "app",
        "auth",
        "auth/google",
        "auth/icloud",
        "components",
        "content",
        "enrollment",
        "extension",
        "runtime",
        "vault",
    ] {
        assert!(lib_root.join(package).is_dir(), "missing {package} package");
    }

    Ok(())
}

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
        "nook-app/nook-web/nook-web-shared/src/vault-app/lib/runtime/wasm-bootstrap.ts",
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
    let browser_operations = read(
        &root,
        "nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/creation-queue.ts",
    );
    for browser_lifecycle_enum in [
        "PendingVaultCreationKind",
        "VaultCreationQueueKind",
        "ExistingVaultImportQueueKind",
        "EnrollmentSubmitQueueKind",
    ] {
        assert!(browser_operations.contains(browser_lifecycle_enum));
    }
    assert!(!browser_operations.contains("DeviceProtectedOperationState"));

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
