use super::*;

#[test]
#[expect(
    clippy::unnecessary_wraps,
    reason = "integration contracts share a fallible test signature"
)]
fn extension_and_release_contract_preserve_origin_isolation() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let manifest = root.read("nook-app/nook-web/nook-web-extension/src/manifest.ts");
    let vault_target =
        root.read("nook-app/nook-web/nook-web-extension/src/lib/simple-vault-target.ts");
    for required_contract in [
        "nook_vault_app_exclude_match_patterns(simpleVaultBaseUrl)",
        "exclude_matches: vaultAppExclusions",
        "simple_vault_match_pattern(simpleVaultBaseUrl)",
        "sentinel_vault_match_patterns(simpleVaultBaseUrl)",
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
            && vault_target.contains("default_simple_vault_url"),
        "extension vault targeting must call companion WASM host policy"
    );
    let vault_host_policy =
        root.read("nook-app/nook-platform/nook-companion-core/src/vault_host_policy.rs");
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

    let release = root.read(".github/workflows/release.yml");
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
    let deploy_script = root.read(".github/scripts/ci-release-deploy-vaults.sh");
    for required in [
        "nook-vault-simple/dist",
        "nook-vault-sentinel/dist",
        "node /meta-secret/nook/nook-app/nook-web/nook-web-app/node_modules/.bin/wrangler",
        "wrangler pages project create",
        "wrangler pages deploy",
    ] {
        assert!(
            deploy_script.contains(required),
            "release vault deploy script missing {required}"
        );
    }
    for forbidden in ["docker run", "npx --yes wrangler"] {
        assert!(
            !deploy_script.contains(forbidden),
            "release vault deployment must run directly in its Kubernetes Pod: {forbidden}"
        );
    }
    let domains_script = root.read(".github/scripts/ci-release-attach-prod-domains.sh");
    for required in [
        "simple.nokey.sh:nokey-simple",
        "sentinel.nokey.sh:nokey-sentinel",
        "nook-app-kind",
        "failed release verification",
    ] {
        assert!(
            domains_script.contains(required),
            "release domain attach script missing {required}"
        );
    }
    assert!(
        !domains_script.contains("for attempt in") && !domains_script.contains("sleep 10"),
        "release domain verification must probe exact-release metadata once"
    );
    let research_verifier = root.read(".github/scripts/web-research-verify-live.sh");
    assert!(
        research_verifier.contains("Web research deployment verification failed")
            && !research_verifier.contains("--retry")
            && !research_verifier.contains("sleep "),
        "web research deployment verification must probe the live artifact once"
    );
    Ok(())
}

#[test]
#[expect(
    clippy::unnecessary_wraps,
    reason = "integration contracts share a fallible test signature"
)]
fn development_and_release_wasm_build_modes_stay_separate() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let main = root.read(".github/workflows/main.yml");
    assert!(main.contains("WASM_BUILD_MODE=dev"));
    assert!(
        !main.contains("WASM_BUILD_MODE=prod") && !main.contains("WASM_BUILD_MODE: prod"),
        "main must not serialize production wasm optimization for development artifacts"
    );

    let release = root.read(".github/workflows/release.yml");
    assert!(release.contains("WASM_BUILD_MODE: prod"));
    assert!(
        !release.contains("WASM_BUILD_MODE=dev"),
        "release artifacts must remain production-optimized"
    );
    Ok(())
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one deployment contract verifies the complete origin-isolation boundary"
)]
#[expect(
    clippy::unnecessary_wraps,
    reason = "integration contracts share a fallible test signature"
)]
fn development_cloudflare_deploy_preserves_isolated_origins() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let main = root.read(".github/workflows/main.yml");
    for required in [
        "bash .github/scripts/ci-main-deploy-development.sh",
        "bash .github/scripts/ci-main-configure-dev-domains.sh",
        "name: Setup Node for host Pages deploy",
        "NOOK_WRANGLER_VERSION: \"4.120.0\"",
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

    let deploy_script = root.read(".github/scripts/ci-main-deploy-development.sh");
    for required in [
        "bash \"$ROOT/.github/scripts/ci-pr-host-pages-deploy.sh\"",
        "deploy nokey-sh development nook-app/nook-web/nook-web-app/dist/site",
        "deploy nokey-simple development nook-app/nook-web/nook-vault-simple/dist",
        "deploy nokey-sentinel development nook-app/nook-web/nook-vault-sentinel/dist",
    ] {
        assert!(
            deploy_script.contains(required),
            "main development deploy script is missing isolation invariant: {required}"
        );
    }

    let domains_script = root.read(".github/scripts/ci-main-configure-dev-domains.sh");
    for required in [
        "site_pages_host=\"development.nokey-sh.pages.dev\"",
        "simple_pages_host=\"development.nokey-simple.pages.dev\"",
        "sentinel_pages_host=\"development.nokey-sentinel.pages.dev\"",
        "grep -Fq '<title>Nook — Keys, not accounts</title>'",
        "grep -Fq '<meta name=\"nook-app-kind\" content=\"simple\"'",
        "grep -Fq '<meta name=\"nook-app-kind\" content=\"sentinel\"'",
        "zones/$zone_id/purge_cache",
        "Cloudflare zone administration was unavailable; verifying live domains",
        "cache_bust=\"nook_commit=$COMMIT_SHA\"",
        "EXTENSION_CACHE_BUST=\"$COMMIT_SHA\"",
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
    assert!(
        !domains_script.contains("Waiting for isolated development domains")
            && !domains_script.contains("Waiting for exact-head development extension artifacts"),
        "main development verification must fail directly"
    );

    let pull_request = root.read(".github/workflows/pr.yml");
    let preview_action = root.read(".github/actions/nook-pr-preview/action.yml");
    assert!(
        pull_request.contains("uses: ./.github/actions/nook-pr-preview")
            && preview_action.contains("bash .github/scripts/ci-pr-deploy-and-verify-previews.sh")
            && preview_action.contains("wait \"$product_pid\" || failed=1")
            && preview_action.contains("wait \"$research_pid\" || failed=1"),
        "PR preview deploy action must invoke the host Pages script and join both uploads"
    );
    let pr_deploy_script = root.read(".github/scripts/ci-pr-deploy-and-verify-previews.sh");
    assert!(
        pr_deploy_script.contains("EXTENSION_CACHE_BUST=\"$HEAD_SHA\""),
        "PR extension verification must use one exact-head cache key"
    );
    assert!(
        pr_deploy_script.contains("EXTENSION_FETCH_ORIGIN_URL=\"$site_deployment_url/\"")
            && pr_deploy_script.contains("deployment_url_from_log()")
            && pr_deploy_script.contains("^https://[0-9a-f]{8}\\.nokey-sh\\.pages\\.dev$"),
        "PR extension verification must read the immutable deployment rather than race the alias"
    );
    assert!(
        !pr_deploy_script.contains("Waiting for exact-head extension metadata")
            && !pr_deploy_script.contains("Waiting for isolated aliases"),
        "PR deployment must fail directly instead of polling exact-head evidence"
    );

    let release = root.read(".github/workflows/release.yml");
    assert!(
        release.contains("task ci:release:verify-extension"),
        "release extension verification must invoke the Taskfile entry"
    );
    let release_extension = root.read(".github/scripts/ci-release-verify-extension.sh");
    assert!(
        release_extension.contains("EXTENSION_CACHE_BUST=\"$RELEASE_SHA\"")
            && !release_extension.contains("Waiting for exact-release extension artifacts"),
        "release extension verification must check exact-release artifacts once"
    );

    let verifier = root.read("nook-app/nook-web/nook-web-extension/scripts/verify-deployment.sh");
    for required in [
        "cache_busted_url()",
        "fetch_from_selected_origin \"$(cache_busted_url \"$EXTENSION_METADATA_URL\")\"",
        "fetch_from_selected_origin \"$(cache_busted_url \"${fetch_site_url}${download_url#\"$site_url\"}\")\"",
        "fetch_from_selected_origin \"$(cache_busted_url \"${fetch_site_url}${checksum_url#\"$site_url\"}\")\"",
        "Extension deployment verification failed at line $LINENO",
    ] {
        assert!(
            verifier.contains(required),
            "extension deployment verifier is missing cache/diagnostic invariant: {required}"
        );
    }

    let docker_tasks = root.read("nook-app/nook-web/docker/Taskfile.yml");
    assert!(
        docker_tasks.contains("-e CF_PAGES_DIST_DIR"),
        "the selected Cloudflare artifact directory must reach the sealed deploy container"
    );

    let ci_tasks = root.read("nook-app/ci/Taskfile.yml");
    assert!(
        ci_tasks.contains("*) deploy_dir=\"{{.REPO_ROOT}}/$deploy_dir\" ;;"),
        "repo-relative Cloudflare artifact directories must resolve from the repository root"
    );
    Ok(())
}
