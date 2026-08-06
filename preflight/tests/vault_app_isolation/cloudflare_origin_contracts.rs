use super::*;

#[test]
fn extension_and_release_contract_preserve_origin_isolation() -> anyhow::Result<()> {
    let root = repository_root();
    let manifest = read(
        &root,
        "nook-app/nook-web/nook-web-extension/src/manifest.ts",
    );
    let vault_target = read(
        &root,
        "nook-app/nook-web/nook-web-extension/src/lib/simple-vault-target.ts",
    );
    for required_contract in [
        "nookVaultAppExcludeMatchPatterns(simpleVaultBaseUrl)",
        "exclude_matches: vaultAppExclusions",
        "simpleVaultMatchPattern(simpleVaultBaseUrl)",
        "sentinelVaultMatchPatterns(simpleVaultBaseUrl)",
        "externally_connectable: {",
        "matches: [simpleVaultMatch]",
    ] {
        assert!(
            manifest.contains(required_contract),
            "extension manifest must preserve dynamic vault isolation through {required_contract}"
        );
    }
    assert!(
        vault_target.contains("nook-companion-wasm")
            && vault_target.contains("defaultSimpleVaultUrl"),
        "extension vault targeting must call companion WASM host policy"
    );
    let vault_host_policy = read(
        &root,
        "nook-app/nook-platform/nook-companion-core/src/vault_host_policy.rs",
    );
    for production_boundary in [
        "https://simple.nokey.sh/",
        "https://simple.dev.nokey.sh/*",
        "https://sentinel.nokey.sh/*",
        "https://*.nokey-simple.pages.dev/*",
        "https://*.nokey-sentinel.pages.dev/*",
    ] {
        assert!(
            vault_host_policy.contains(production_boundary),
            "companion vault host policy must preserve production boundary {production_boundary}"
        );
    }

    let release = read(&root, ".github/workflows/release.yml");
    for required in [
        "task ci:release:deploy-vaults",
        "task ci:release:attach-prod-domains",
        "uses: actions/github-script@v9",
    ] {
        assert!(
            release.contains(required),
            "release workflow missing {required}"
        );
    }
    assert!(
        !release.contains("gh release "),
        "release publication must not assume the self-hosted runner has the GitHub CLI"
    );
    let deploy_script = read(&root, ".github/scripts/ci-release-deploy-vaults.sh");
    for required in [
        "nook-vault-simple/dist",
        "nook-vault-sentinel/dist",
        "node:24-trixie-slim",
        "docker run --rm",
        "npx --yes wrangler@4",
    ] {
        assert!(
            deploy_script.contains(required),
            "release vault deploy script missing {required}"
        );
    }
    let domains_script = read(&root, ".github/scripts/ci-release-attach-prod-domains.sh");
    for required in [
        "simple.nokey.sh:nokey-simple",
        "sentinel.nokey.sh:nokey-sentinel",
        "nook-app-kind",
    ] {
        assert!(
            domains_script.contains(required),
            "release domain attach script missing {required}"
        );
    }
    Ok(())
}

#[test]
fn development_and_release_wasm_build_modes_stay_separate() -> anyhow::Result<()> {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    assert!(main.contains("WASM_BUILD_MODE=dev"));
    assert!(
        !main.contains("WASM_BUILD_MODE=prod") && !main.contains("WASM_BUILD_MODE: prod"),
        "main must not serialize production wasm optimization for development artifacts"
    );

    let release = read(&root, ".github/workflows/release.yml");
    assert!(release.contains("WASM_BUILD_MODE=prod"));
    assert!(
        !release.contains("WASM_BUILD_MODE=dev"),
        "release artifacts must remain production-optimized"
    );
    Ok(())
}

#[test]
fn development_cloudflare_deploy_preserves_isolated_origins() -> anyhow::Result<()> {
    let root = repository_root();
    let main = read(&root, ".github/workflows/main.yml");
    for required in [
        "task ci:main:deploy-development",
        "task ci:main:configure-dev-domains",
        "CI_MAIN_SIMPLE_DOMAIN: simple.dev.nokey.sh",
        "CI_MAIN_SENTINEL_DOMAIN: sentinel.dev.nokey.sh",
    ] {
        assert!(
            main.contains(required),
            "main development deployment is missing isolation invariant: {required}"
        );
    }
    assert!(
        main.contains("VITE_SITE_URL=${{ env.CI_MAIN_DEV_URL }}")
            && main.contains("VITE_SIMPLE_APP_URL=${{ env.CI_MAIN_SIMPLE_URL }}")
            && main.contains("VITE_SENTINEL_APP_URL=${{ env.CI_MAIN_SENTINEL_URL }}"),
        "development artifacts must embed their stable isolated channel origins"
    );

    let deploy_script = read(&root, ".github/scripts/ci-main-deploy-development.sh");
    for required in [
        "deploy nokey-sh development nook-app/nook-web/nook-web-app/dist/site",
        "deploy nokey-simple development nook-app/nook-web/nook-vault-simple/dist",
        "deploy nokey-sentinel development nook-app/nook-web/nook-vault-sentinel/dist",
    ] {
        assert!(
            deploy_script.contains(required),
            "main development deploy script is missing isolation invariant: {required}"
        );
    }

    let domains_script = read(&root, ".github/scripts/ci-main-configure-dev-domains.sh");
    for required in [
        "site_pages_host=\"development.nokey-sh.pages.dev\"",
        "simple_pages_host=\"development.nokey-simple.pages.dev\"",
        "sentinel_pages_host=\"development.nokey-sentinel.pages.dev\"",
        "grep -Fq '<title>Nook — Keys, not accounts</title>'",
        "grep -Fq '<meta name=\"nook-app-kind\" content=\"simple\"'",
        "grep -Fq '<meta name=\"nook-app-kind\" content=\"sentinel\"'",
        "zones/$zone_id/purge_cache",
        "Cloudflare zone administration was unavailable; verifying live domains",
        "cache_bust=\"nook_commit=$COMMIT_SHA&attempt=$attempt\"",
        "EXTENSION_CACHE_BUST=\"$COMMIT_SHA-$attempt\"",
        "Waiting for exact-head development extension artifacts",
        "https://$DEV_DOMAIN/site/",
        "https://$DEV_DOMAIN/simple/",
        "https://$DEV_DOMAIN/sentinel/",
        "[ \"$site_status\" = \"404\" ]",
        "[ \"$simple_status\" = \"404\" ]",
        "[ \"$sentinel_status\" = \"404\" ]",
        "[ \"$simple_extension_status\" = \"200\" ]",
        "[ \"$sentinel_extension_status\" = \"404\" ]",
    ] {
        assert!(
            domains_script.contains(required),
            "main development domain script is missing isolation invariant: {required}"
        );
    }

    let pull_request = read(&root, ".github/workflows/pr.yml");
    assert!(
        pull_request.contains("task ci:pr:deploy-and-verify-previews"),
        "PR preview deploy must invoke the Taskfile entry"
    );
    let pr_deploy_script = read(&root, ".github/scripts/ci-pr-deploy-and-verify-previews.sh");
    assert!(
        pr_deploy_script.contains("EXTENSION_CACHE_BUST=\"$HEAD_SHA-$attempt\""),
        "PR extension verification must bypass mutable artifact caches on every convergence attempt"
    );

    let release = read(&root, ".github/workflows/release.yml");
    assert!(
        release.contains("task ci:release:verify-extension"),
        "release extension verification must invoke the Taskfile entry"
    );
    let release_extension = read(&root, ".github/scripts/ci-release-verify-extension.sh");
    assert!(
        release_extension.contains("EXTENSION_CACHE_BUST=\"$RELEASE_SHA-$attempt\"")
            && release_extension.contains("Waiting for exact-release extension artifacts"),
        "release extension verification must retry cache-busted exact-release artifacts"
    );

    let verifier = read(
        &root,
        "nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh",
    );
    for required in [
        "cache_busted_url()",
        "fetch_from_selected_origin \"$(cache_busted_url \"$EXTENSION_METADATA_URL\")\"",
        "fetch_from_selected_origin \"$(cache_busted_url \"$download_url\")\"",
        "fetch_from_selected_origin \"$(cache_busted_url \"$checksum_url\")\"",
        "Extension deployment verification failed at line $LINENO",
    ] {
        assert!(
            verifier.contains(required),
            "extension deployment verifier is missing cache/diagnostic invariant: {required}"
        );
    }

    let docker_tasks = read(&root, "nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("-e CF_PAGES_DIST_DIR"),
        "the selected Cloudflare artifact directory must reach the sealed deploy container"
    );

    let ci_tasks = read(&root, "nook-app/.task/ci.yml");
    assert!(
        ci_tasks.contains("*) deploy_dir=\"{{.REPO_ROOT}}/$deploy_dir\" ;;"),
        "repo-relative Cloudflare artifact directories must resolve from the repository root"
    );
    Ok(())
}
