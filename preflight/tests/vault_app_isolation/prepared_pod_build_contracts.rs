use super::hosted_delivery_contracts;
use super::*;

#[test]
fn ci_reuses_wasm_and_web_artifacts_instead_of_rebuilding_them() -> anyhow::Result<()> {
    let root = repository_root();
    let release = read(&root, ".github/workflows/release.yml");
    assert_eq!(
        release.matches("WASM_BUILD_MODE: prod").count(),
        1,
        "release must perform one optimized WASM artifact batch"
    );
    assert!(
        release.contains("REPO_ROOT=\"$GITHUB_WORKSPACE/.nook/release-workflow\"\n          PREFLIGHT_SOURCE_ROOT=\"$GITHUB_WORKSPACE\"")
            && release.contains("task --taskfile \"$GITHUB_WORKSPACE/.nook/release-workflow/Taskfile.yml\"\n          preflight"),
        "release must run current repository preflight tooling against the immutable source before publishing its job image"
    );
    let manual_e2e = read(&root, ".github/workflows/e2e-pr.yml");
    assert!(
        manual_e2e.contains("WASM_BUILD_MODE: prod"),
        "manual PR e2e images must preserve the production WASM build mode"
    );
    assert!(
        !release.contains("Build stable Pages artifact") && !release.contains("run: task setup"),
        "release must extract the already-tested sealed image instead of running setup twice"
    );
    let preflight_bake = read(&root, "preflight/docker-bake.hcl");
    let preflight_dockerfile = read(&root, "preflight/Dockerfile");
    let preflight_tasks = read(&root, "preflight/Taskfile.yml");
    assert!(
        preflight_bake.contains("repository-source = PREFLIGHT_SOURCE_CONTEXT")
            && preflight_dockerfile.contains("COPY --from=repository-source / /meta-secret/nook")
            && preflight_tasks.contains("PREFLIGHT_SOURCE_CONTEXT=\"{{.PREFLIGHT_SOURCE_ROOT}}\""),
        "current preflight tooling must inspect a separately selected immutable source context"
    );
    for required in [
        "VITE_SITE_URL: ${{ env.CI_RELEASE_URL }}",
        "VITE_PUBLIC_APP_URL: ${{ env.CI_RELEASE_URL }}",
        "VITE_VAULT_SYNC_INTERVAL_MS: ${{ env.CI_RELEASE_VITE_VAULT_SYNC_INTERVAL_MS }}",
    ] {
        assert!(
            release.contains(required),
            "initial release build missing production input: {required}"
        );
    }

    let ci = read(&root, "nook-app/ci/Taskfile.yml");
    let web_host = section(&ci, "  _ci:pr:web:host:\n", "\n  ci:pr:ui-demo:");
    assert!(
        web_host.contains("task: docker:ci:web:build") && !web_host.contains("task: docker:task"),
        "hosted PR web verification must run inside the CI image build instead of serializing a second container"
    );
    let verify = section(&ci, "  _ci:pr:parallel:\n", "\n  _ci:main:build:");
    assert!(
        !verify.contains("_web:build:parallel"),
        "the sealed image already contains the validated production web build"
    );
    hosted_delivery_contracts::assert_main_web_e2e_core_contract(&ci);

    let web = read(&root, "nook-app/nook-web/Taskfile.yml");
    let e2e = section(
        &web,
        "  _web:test:e2e:parallel:\n",
        "\n  _web:e2e:build-if-needed:",
    );
    assert!(e2e.contains("_web:e2e:build-if-needed"));
    assert!(
        !e2e.contains("bun run build"),
        "the e2e task must rely on the freshness-checked build instead of rebuilding unconditionally"
    );

    hosted_delivery_contracts::assert_e2e_build_if_needed_contract(&root);

    let extension = read(&root, "nook-app/nook-web/nook-web-extension/Taskfile.yml");
    let extension_check = section(
        &extension,
        "  _extension:check:\n",
        "\n  _extension:test:e2e:",
    );
    assert!(extension_check.contains("bun run check"));
    assert!(
        !extension_check.contains("bun run build"),
        "extension setup already sealed a validated build"
    );

    let web_base = read(&root, "nook-app/nook-web/docker/web.Dockerfile");
    assert!(web_base.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium"));
    assert!(web_base.contains("chromium ffmpeg xvfb"));
    assert!(
        !web_base.contains("playwright@${PLAYWRIGHT_VERSION} install"),
        "e2e must not download Playwright's duplicate Chromium and headless-shell bundle"
    );
    let web_image = read(&root, "nook-app/nook-web/nook-web-app/Dockerfile");
    let web_image_bake = read(&root, "nook-app/nook-web/nook-web-app/docker-bake.hcl");
    assert!(web_image.contains("FROM web-runtime AS nook-web-source"));
    assert!(web_image.contains("test -x \"$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH\""));
    assert!(web_image_bake.contains("web-runtime   = \"target:web-base\""));
    assert_eq!(
        web_image_bake
            .matches("web-runtime = \"target:web-e2e-base\"")
            .count(),
        2,
        "both browser image targets must replace the distinct runtime context with Chromium"
    );
    assert!(
        !web_image_bake.contains("web-base = \"target:web-e2e-base\""),
        "a named context must not collide with the internal web-base Dockerfile stage"
    );
    assert!(web_image.contains("playwright-core/browsers.json"));
    assert!(web_image.contains("/usr/bin/ffmpeg"));
    for config in [
        "nook-app/nook-web/nook-web-app/playwright.config.ts",
        "nook-app/nook-web/nook-web-app/playwright.isolation.config.ts",
        "nook-app/nook-web/nook-web-research/playwright.config.ts",
        "agentic-ai/minds/hive-console/playwright.config.ts",
    ] {
        let playwright_config = read(&root, config);
        assert!(
            playwright_config.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
                && playwright_config.contains("launchOptions"),
            "{config} must pass the e2e image's system Chromium through Playwright launch options"
        );
    }
    assert!(
        read(
            &root,
            "nook-app/nook-web/nook-web-extension/e2e/helpers/extension-smoke-runtime.ts",
        )
        .contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
        "extension browser helpers must launch the e2e image's system Chromium"
    );
    for workflow in [
        ".github/workflows/e2e-pr.yml",
        ".github/workflows/hive.yml",
        ".github/workflows/main.yml",
        ".github/workflows/pr.yml",
        ".github/workflows/release.yml",
        ".github/workflows/remote.yml",
        ".github/workflows/web-research.yml",
    ] {
        assert!(
            read(&root, workflow)
                .contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium"),
            "{workflow} must explicitly pass system Chromium through the ARC container hook"
        );
    }
    let hive_workflow = read(&root, ".github/workflows/hive.yml");
    let hive_global = section(&hive_workflow, "env:\n", "\njobs:\n");
    let hive_console = section(&hive_workflow, "  console:\n", "\n  console-untrusted:\n");
    assert!(
        !hive_global.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
            && hive_console.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium"),
        "Hive must scope system Chromium to the ARC container job so hosted validation uses Playwright Chromium"
    );
    let research_workflow = read(&root, ".github/workflows/web-research.yml");
    let research_global = section(&research_workflow, "env:\n", "\njobs:\n");
    let research_deploy = section(
        &research_workflow,
        "  deploy:\n",
        "\n      - name: Install dependencies",
    );
    assert!(
        !research_global.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
            && research_deploy.contains("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium"),
        "research must scope system Chromium to the ARC container job so hosted validation uses Playwright Chromium"
    );
    let pr_workflow = read(&root, ".github/workflows/pr.yml");
    let pr_ui_demo = section(&pr_workflow, "  ui-demo:\n", "\n  preview:\n");
    assert!(
        !pr_ui_demo.contains("context.payload") && !pr_ui_demo.contains("context.issue"),
        "ARC container actions must receive PR identity explicitly instead of reading a missing event file"
    );
    assert!(
        !read(&root, ".github/workflows/web-research.yml").contains("context.payload"),
        "ARC research actions must receive event identity explicitly"
    );

    let main_workflow = read(&root, ".github/workflows/main.yml");
    let main_browser_image = section(
        &main_workflow,
        "      - name: Publish exact-source browser job image\n",
        "\n      - name: Preserve cache telemetry",
    );
    for required in [
        "VITE_BASE: ${{ env.CI_MAIN_VITE_BASE }}",
        "VITE_SITE_URL: ${{ env.CI_MAIN_DEV_URL }}",
        "VITE_PUBLIC_APP_URL: ${{ env.CI_MAIN_DEV_URL }}",
        "VITE_SIMPLE_APP_URL: ${{ env.CI_MAIN_SIMPLE_URL }}",
        "VITE_SENTINEL_APP_URL: ${{ env.CI_MAIN_SENTINEL_URL }}",
        "NOOK_EXTENSION_CHANNEL: development",
        "NOOK_EXTENSION_COMMIT: ${{ github.sha }}",
    ] {
        assert!(
            main_browser_image.contains(required),
            "Main browser image must preserve build configuration: {required}"
        );
    }
    let main_web_e2e = section(&main_workflow, "  web-e2e:\n", "\n  extension-e2e:\n");
    for required in [
        "VITE_SITE_URL: ${{ env.CI_MAIN_DEV_URL }}",
        "VITE_SIMPLE_APP_URL: ${{ env.CI_MAIN_SIMPLE_URL }}",
        "VITE_SENTINEL_APP_URL: ${{ env.CI_MAIN_SENTINEL_URL }}",
    ] {
        assert!(
            main_web_e2e.contains(required),
            "Main web e2e must expect the development origins sealed into its browser image: {required}"
        );
    }

    let pr_browser_image = section(
        &pr_workflow,
        "      - name: Publish exact-source PR browser job image\n",
        "\n      - name: Upload preview dist handoff",
    );
    for required in [
        "VITE_SITE_URL: https://pr-${{ github.event.pull_request.number }}.nokey-sh.pages.dev",
        "VITE_PUBLIC_APP_URL: https://pr-${{ github.event.pull_request.number }}.nook-1n8.pages.dev",
        "VITE_SIMPLE_APP_URL: https://pr-${{ github.event.pull_request.number }}.nokey-simple.pages.dev",
        "VITE_SENTINEL_APP_URL: https://pr-${{ github.event.pull_request.number }}.nokey-sentinel.pages.dev",
        "NOOK_EXTENSION_CHANNEL: pr-${{ github.event.pull_request.number }}",
        "NOOK_EXTENSION_COMMIT: ${{ github.event.pull_request.head.sha }}",
    ] {
        assert!(
            pr_browser_image.contains(required),
            "PR browser image must preserve preview configuration: {required}"
        );
    }
    Ok(())
}
