use super::*;

#[test]
fn svelte_build_surfaces_support_runtime_typescript_enums() -> anyhow::Result<()> {
    let root = repository_root();
    for path in [
        "nook-app/nook-web/nook-web-app/svelte.config.js",
        "nook-app/nook-web/nook-vault-simple/svelte.config.js",
        "nook-app/nook-web/nook-vault-sentinel/svelte.config.js",
        "nook-app/nook-web/nook-web-research/svelte.config.js",
        "nook-app/nook-web/nook-web-extension/e2e/mock-auth/svelte.config.js",
    ] {
        let config = read(&root, path);
        assert!(
            config.contains("vitePreprocess({ script: true })"),
            "{path} must preprocess TypeScript script blocks so Svelte components can use runtime enums"
        );
    }

    let extension_build = read(
        &root,
        "nook-app/nook-web/nook-web-extension/scripts/build.ts",
    );
    assert!(
        extension_build.contains("svelte({ preprocess: vitePreprocess({ script: true }) })"),
        "the config-free extension popup build must preprocess TypeScript script blocks"
    );

    let dashboard = read(
        &root,
        "nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/DevicesAccessDashboard.svelte",
    );
    assert!(dashboard.contains("enum DashboardLoadKind"));
    assert!(dashboard.contains("kind: typeof DashboardLoadKind.Ready; view: DashboardView"));
    Ok(())
}
