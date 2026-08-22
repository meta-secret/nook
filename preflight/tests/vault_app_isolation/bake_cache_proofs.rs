//! Formal static Bake cache proofs for GitHub Actions + Zot.
//!
//! These theorems encode the restore/publish graph that keeps chef cooks CACHED.
//! Runtime CACHED proof for WASM deps remains Main `verify-wasm-gha-cache.sh`.

use super::*;
use anyhow::Context;
use std::fs;

#[path = "bake_cache_proofs/support.rs"]
mod support;

use support::*;

#[test]
fn theorem_empty_cache_overrides_banned_repo_wide() -> anyhow::Result<()> {
    let root = repository_root();
    let mut paths = Vec::new();
    collect_cache_caller_paths(&root.join("nook-app"), &mut paths)?;
    collect_cache_caller_paths(&root.join("preflight"), &mut paths)?;
    collect_cache_caller_paths(&root.join(".github/scripts"), &mut paths)?;
    collect_cache_caller_paths(&root.join(".github/workflows"), &mut paths)?;
    paths.sort();
    paths.dedup();
    assert!(
        !paths.is_empty(),
        "repo walk must discover Bake/Task callers to proof against empty cache overrides"
    );
    for path in paths {
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(path.as_path())
            .to_string_lossy();
        let text = fs::read_to_string(&path).with_context(|| format!("failed to read {rel}"))?;
        assert_no_empty_bake_cache_overrides(rel.as_ref(), &text);
    }
    Ok(())
}

#[test]
fn theorem_pr_workflows_have_no_host_rust_compilation() -> anyhow::Result<()> {
    let root = repository_root();
    for relative in [
        ".github/workflows/pr.yml",
        ".github/workflows/rust-ecosystem-checks.yml",
        ".github/workflows/hive.yml",
        ".github/workflows/repository-policy.yml",
    ] {
        let workflow = read(&root, relative);
        for (index, line) in workflow.lines().enumerate() {
            let command = line.trim_start();
            for compiler in ["cargo ", "rustc ", "rustup ", "wasm-pack "] {
                assert!(
                    !command.starts_with(compiler)
                        && !command.starts_with(&format!("run: {compiler}")),
                    "{relative}:{} invokes uncached host Rust command {compiler}",
                    index + 1
                );
            }
        }
    }
    Ok(())
}

#[test]
fn theorem_short_parent_import_graph() -> anyhow::Result<()> {
    let root = repository_root();
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let preflight_bake = read(&root, "preflight/docker-bake.hcl");

    assert_scope_arms(
        &rust_bake,
        "rust_deps_cache_from",
        &["nook-rust-deps-v3"],
        &[],
        &["nook-rust-base-v1"],
    )?;
    assert_scope_arms(
        &rust_bake,
        "rust_native_source_cache_from",
        &["nook-rust-native-source-v3", "nook-rust-deps-v3"],
        &[],
        &["nook-rust-base-v1"],
    )?;
    let native_source = assignment_body(&rust_bake, "rust_native_source_cache_from")?;
    let native_main =
        split_main_available_arm(native_source, "GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE")?;
    assert!(
        native_main.contains("nook/buildcache/nook-rust-native-source-v3")
            && !native_main.contains("nook-rust-deps-v3")
            && !native_main.contains("nook-rust-native-deps-input-v2"),
        "Main native-source restore must import that full graph alone"
    );
    // Main non-FALLBACK restores the fingerprinted scope; PR FALLBACK also lists
    // the git-scoped deps-v5 name. Either form proves own-scope deps restore.
    assert_scope_arms(
        &rust_bake,
        "rust_wasm_deps_cache_from",
        &["nook-rust-wasm-source-v2"],
        &[&["nook-rust-wasm-deps-v5", "${GHA_RUST_WASM_DEPS_SCOPE}"]],
        &["nook-rust-base-v1", "nook-rust-deps-v3"],
    )?;
    assert_scope_arms(
        &rust_bake,
        "rust_wasm_source_cache_from",
        &["nook-rust-wasm-source-v2"],
        &[&["nook-rust-wasm-deps-v5", "${GHA_RUST_WASM_DEPS_SCOPE}"]],
        &["nook-rust-base-v1", "nook-rust-deps-v3"],
    )?;
    let wasm_source = assignment_body(&rust_bake, "rust_wasm_source_cache_from")?;
    let wasm_main =
        split_main_available_arm(wasm_source, "GHA_CACHE_MAIN_RUST_WASM_SOURCE_AVAILABLE")?;
    assert!(
        wasm_main.contains("nook/buildcache/nook-rust-wasm-source-v2")
            && !wasm_main.contains("nook-rust-wasm-deps-v5")
            && !wasm_main.contains("nook-rust-wasm-deps-input-v2"),
        "Main WASM source restore must import that full graph alone"
    );
    assert_scope_arms(
        &rust_bake,
        "rust_wasm_node_cache_from",
        &["nook-rust-wasm-node-v1"],
        &[],
        &["nook-rust-wasm-source-v2", "nook-rust-wasm-deps-v5"],
    )?;
    assert_scope_arms(
        &rust_bake,
        "rust_ecosystem_policy_tools_cache_from",
        &["nook-rust-ecosystem-policy-tools-v4"],
        &[],
        &["nook-rust-base-v1"],
    )?;
    assert_scope_arms(
        &rust_bake,
        "rust_ecosystem_dylint_cache_from",
        &["nook-rust-ecosystem-dylint-v3"],
        &[],
        &["nook-rust-base-v1", "nook-rust-ecosystem-nightly"],
    )?;
    assert_scope_arms(
        &rust_bake,
        "rust_ecosystem_fuzz_cache_from",
        &["nook-rust-ecosystem-fuzz-v3"],
        &[],
        &["nook-rust-base-v1", "nook-rust-ecosystem-nightly"],
    )?;
    assert_scope_arms(
        &rust_bake,
        "rust_ecosystem_kani_cache_from",
        &["nook-rust-ecosystem-kani-v1"],
        &[],
        &["nook-rust-base-v1", "nook-rust-deps-v3"],
    )?;
    assert_scope_arms(
        &preflight_bake,
        "preflight_cache_from",
        &["nook-preflight-v1"],
        &[],
        &["nook-rust-base-v1"],
    )?;
    Ok(())
}

#[test]
fn theorem_exact_scope_excludes_main_then_cold_scope_falls_back() -> anyhow::Result<()> {
    let root = repository_root();
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let preflight_bake = read(&root, "preflight/docker-bake.hcl");
    let web_image_bake = read(&root, "nook-app/nook-web/docker/web.docker-bake.hcl");
    for (bake, name, availability, exact_marker, main_ref) in [
        (
            rust_bake.as_str(),
            "rust_base_cache_from",
            "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE",
            "nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-base-v1",
        ),
        (
            rust_bake.as_str(),
            "rust_ecosystem_policy_tools_cache_from",
            "GHA_CACHE_EXACT_RUST_POLICY_TOOLS_AVAILABLE",
            "nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-ecosystem-policy-tools-v4",
        ),
        (
            rust_bake.as_str(),
            "rust_ecosystem_dylint_cache_from",
            "GHA_CACHE_EXACT_RUST_DYLINT_AVAILABLE",
            "nook-rust-ecosystem-dylint-v3${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-ecosystem-dylint-v3",
        ),
        (
            rust_bake.as_str(),
            "rust_ecosystem_fuzz_cache_from",
            "GHA_CACHE_EXACT_RUST_FUZZ_AVAILABLE",
            "nook-rust-ecosystem-fuzz-v3${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-ecosystem-fuzz-v3",
        ),
        (
            rust_bake.as_str(),
            "rust_ecosystem_deterministic_cache_from",
            "GHA_CACHE_EXACT_RUST_DETERMINISTIC_AVAILABLE",
            "nook-rust-ecosystem-deterministic-v1${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-ecosystem-deterministic-v1",
        ),
        (
            rust_bake.as_str(),
            "rust_ecosystem_kani_cache_from",
            "GHA_CACHE_EXACT_RUST_KANI_AVAILABLE",
            "nook-rust-ecosystem-kani-v1${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-ecosystem-kani-v1",
        ),
        (
            rust_bake.as_str(),
            "rust_deps_cache_from",
            "GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE",
            "nook-rust-deps-v3${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-deps-v3",
        ),
        (
            rust_bake.as_str(),
            "rust_wasm_deps_cache_from",
            "GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE",
            "${rust_wasm_deps_write_scope}",
            "nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}",
        ),
        (
            rust_bake.as_str(),
            "rust_native_source_cache_from",
            "GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE",
            "nook-rust-native-source-v3${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-native-source-v3",
        ),
        (
            rust_bake.as_str(),
            "rust_wasm_source_cache_from",
            "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE",
            "nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-wasm-source-v2",
        ),
        (
            rust_bake.as_str(),
            "rust_wasm_node_cache_from",
            "GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE",
            "nook-rust-wasm-node-v1${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-rust-wasm-node-v1",
        ),
        (
            preflight_bake.as_str(),
            "preflight_cache_from",
            "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE",
            "nook-preflight-v1${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-preflight-v1",
        ),
        (
            web_image_bake.as_str(),
            "web_e2e_cache_from",
            "GHA_CACHE_EXACT_WEB_E2E_AVAILABLE",
            "nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}",
            "nook/buildcache/nook-web-e2e-v1",
        ),
    ] {
        let body = assignment_body(bake, name)?;
        let exact = split_exact_available_arm(body, availability)?;
        assert!(
            exact.contains(exact_marker) && !exact.contains(main_ref),
            "{name} must import only its exact full-graph ref when {availability} is set"
        );
        if matches!(
            name,
            "rust_native_source_cache_from" | "rust_wasm_source_cache_from"
        ) {
            let main_availability = if name == "rust_native_source_cache_from" {
                "GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE"
            } else {
                "GHA_CACHE_MAIN_RUST_WASM_SOURCE_AVAILABLE"
            };
            let main = split_main_available_arm(body, main_availability)?;
            assert!(
                main.contains(main_ref),
                "{name} Main-source arm must restore {main_ref} alone"
            );
            let (fallback, _) = split_fallback_arms(body)?;
            assert!(
                !fallback.contains(main_ref),
                "{name} cold fallback must not merge {main_ref} with shorter dependency indexes"
            );
        } else {
            let (fallback, _) = split_fallback_arms(body)?;
            assert!(
                fallback.contains(main_ref),
                "{name} FALLBACK must restore Main {main_ref}"
            );
            if name == "preflight_cache_from" {
                let probed_absent = body
                    .split_once(
                        "GHA_CACHE_EXACT_PROBES_COMPLETE != \"\" && GHA_CACHE_FALLBACK_ENABLED != \"\" ? [",
                    )
                    .map(|(_, rest)| rest)
                    .context("preflight must distinguish a completed hosted probe")?
                    .split_once("] : GHA_CACHE_FALLBACK_ENABLED != \"\" ? [")
                    .map(|(arm, _)| arm)
                    .context("preflight must retain a separate unprobed local fallback")?;
                assert!(
                    probed_absent.contains(main_ref) && !probed_absent.contains(exact_marker),
                    "preflight must not ask BuildKit to import an exact ref already probed as absent"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn theorem_nightly_leaves_publish_only_their_full_graphs() -> anyhow::Result<()> {
    let root = repository_root();
    let docker_tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    for (task, leaf) in [
        ("docker:ecosystem:dylint", "rust-dylint"),
        ("docker:ecosystem:fuzz", "rust-fuzz-smoke"),
    ] {
        let body = taskfile_task_body(&docker_tasks, task)?;
        assert!(
            body.contains("task: docker:rust-base")
                && body.matches(leaf).count() >= 2
                && !body.contains("rust-ecosystem-nightly"),
            "{task} must restore/publish only its own full-graph {leaf} scope"
        );
    }
    Ok(())
}

#[test]
fn theorem_context_parents_never_write_publishers_mode_max() -> anyhow::Result<()> {
    let root = repository_root();
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let core_bake = read(&root, "nook-app/nook-platform/nook-core/docker-bake.hcl");
    let web_toolchain = read(&root, "nook-app/nook-web/docker/toolchain.docker-bake.hcl");
    let app_bake = read(&root, "nook-app/docker-bake.hcl");
    let preflight_bake = read(&root, "preflight/docker-bake.hcl");

    // Nested ecosystem leaves context rust-base. Importing the short rust-base
    // index there orphans nightly/policy RUNs after Main FALLBACK restored them.
    let rust_base_body = bake_target_body(rust_bake.as_str(), "rust-base");
    assert!(
        !rust_base_body.trim().is_empty(),
        "context parent target rust-base must exist"
    );
    assert!(
        !rust_base_body
            .lines()
            .any(|line| line.trim_start().starts_with("cache-from")),
        "context rust-base must omit cache-from so nested nightly/policy leaves are not orphaned"
    );
    assert!(
        !bake_target_assigns_cache_to(rust_bake.as_str(), "rust-base"),
        "context parent rust-base must never declare cache-to"
    );
    let rust_base_restore = bake_target_body(rust_bake.as_str(), "rust-base-restore");
    assert!(
        rust_base_restore
            .lines()
            .any(|line| line.trim_start().starts_with("cache-from"))
            && !bake_target_assigns_cache_to(rust_bake.as_str(), "rust-base-restore"),
        "rust-base-restore must declare cache-from without cache-to"
    );

    assert!(
        !rust_bake.contains("rust-platform-nightly")
            && !rust_bake.contains("rust-ecosystem-nightly = \"target:rust-ecosystem-nightly\"")
            && rust_bake
                .matches("dockerfile = \"nook-app/nook-platform/docker/rust/nightly.Dockerfile\"")
                .count()
                == 2,
        "nightly/dylint/fuzz must share one Dockerfile with no linked nightly context"
    );

    for (target, restore, cache_from) in [
        (
            "builder-core-deps",
            "builder-core-deps-restore",
            "rust_deps_cache_from",
        ),
        (
            "builder-wasm-deps",
            "builder-wasm-deps-restore",
            "rust_wasm_deps_cache_from",
        ),
    ] {
        let body = bake_target_body(core_bake.as_str(), target);
        assert!(
            !body.trim().is_empty(),
            "dependency stage target {target} must exist"
        );
        assert!(
            !body
                .lines()
                .any(|line| line.trim_start().starts_with("cache-from")),
            "dependency stage {target} must omit cache-from so source leaves keep their full lineage"
        );
        assert!(
            !bake_target_assigns_cache_to(core_bake.as_str(), target),
            "dependency stage {target} must never declare cache-to"
        );
        let restore_body = bake_target_body(core_bake.as_str(), restore);
        assert!(
            restore_body.contains(cache_from)
                && !bake_target_assigns_cache_to(core_bake.as_str(), restore),
            "standalone {restore} must own {cache_from} without cache-to"
        );
    }

    let web_deps_body = bake_target_body(web_toolchain.as_str(), "web-deps");
    assert!(
        web_deps_body.contains("cache-from = web_deps_cache_from")
            && !bake_target_assigns_cache_to(web_toolchain.as_str(), "web-deps"),
        "standalone web-deps keeps read-only restore while its publisher owns writes"
    );

    for (bake, target, cache_to_var) in [
        (
            rust_bake.as_str(),
            "rust-base-publish",
            "rust_base_cache_to",
        ),
        (
            core_bake.as_str(),
            "builder-core-deps-publish",
            "rust_deps_cache_to",
        ),
        (
            core_bake.as_str(),
            "builder-wasm-deps-publish",
            "rust_wasm_deps_cache_to",
        ),
        (
            web_toolchain.as_str(),
            "web-deps-publish",
            "web_deps_cache_to",
        ),
    ] {
        let body = bake_target_body(bake, target);
        assert!(
            bake_target_assigns_cache_to(bake, target),
            "publisher {target} must declare cache-to"
        );
        assert!(
            body.contains(cache_to_var),
            "publisher {target} must assign cache-to = {cache_to_var}"
        );
    }

    for (bake, name) in [
        (rust_bake.as_str(), "rust_base_cache_to"),
        (rust_bake.as_str(), "rust_deps_cache_to"),
        (rust_bake.as_str(), "rust_wasm_deps_cache_to"),
        (rust_bake.as_str(), "rust_native_source_cache_to"),
        (rust_bake.as_str(), "rust_wasm_source_cache_to"),
        (rust_bake.as_str(), "rust_wasm_node_cache_to"),
    ] {
        let body = assignment_body(bake, name)?;
        assert!(
            body.contains("mode=${GHA_CACHE_EXPORT_MODE}")
                && body.contains("${write_cache_repository}"),
            "{name} must use the selected export mode under write_cache_repository"
        );
        assert!(
            !body.contains("ignore-error"),
            "Rust {name} cache-to must not ignore export failures"
        );
    }

    assert!(
        app_bake.contains(
            "write_cache_repository = GHA_CACHE_SCOPE_SUFFIX != \"\" ? \"nook/remote-buildcache\" : \"nook/buildcache\""
        ),
        "write_cache_repository must map empty suffix to Main buildcache and isolated writes to remote-buildcache"
    );
    assert!(
        app_bake.contains("variable \"GHA_CACHE_EXPORT_MODE\"")
            && app_bake.contains("default = \"max\"")
            && rust_bake.matches("mode=${GHA_CACHE_EXPORT_MODE}").count() == 11
            && preflight_bake.contains("mode=${GHA_CACHE_EXPORT_MODE}"),
        "trusted publishers must default to full exports while ARC may select minimal exact-SHA handoffs"
    );
    Ok(())
}

#[test]
fn theorem_github_actions_zot_parameter_matrix() -> anyhow::Result<()> {
    let root = repository_root();
    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    let app_bake = read(&root, "nook-app/docker-bake.hcl");
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let web_image = read(&root, "nook-app/nook-web/docker/web.docker-bake.hcl");
    let web_toolchain = read(&root, "nook-app/nook-web/docker/toolchain.docker-bake.hcl");
    let preflight_bake = read(&root, "preflight/docker-bake.hcl");
    let bake = format!("{app_bake}\n{rust_bake}\n{web_image}\n{web_toolchain}\n{preflight_bake}");

    assert!(
        app_bake.contains("default = \"registry.dev.nokey.sh\""),
        "NOOK_REGISTRY_CACHE_HOST must default to registry.dev.nokey.sh"
    );
    assert!(
        !bake.contains("type=gha"),
        "Bake must not use the GitHub Actions cache backend"
    );

    assert!(
        setup.contains("scope_suffix=\"-git-$scope_sha\"")
            && setup.contains("scope_sha=\"${{ github.event.pull_request.head.sha }}\"")
            && setup.contains("GHA_CACHE_FALLBACK_ENABLED=$fallback_enabled")
            && setup.contains("fallback_enabled=1")
            && setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"),
        "PR/Remote isolated writes must use -git-<40-char head SHA> with cold-scope Main fallback enabled"
    );
    assert!(
        setup.contains("docker buildx imagetools inspect")
            && setup.contains("Registry cache probe was inconclusive")
            && setup.contains("manifest unknown|name unknown")
            && setup.contains("cache-from entries are merged, not ordered")
            && setup.contains("Exact cache absent; Main/fingerprint fallback enabled")
            && setup.contains("publish_main_availability")
            && setup.contains("Main cache available:"),
        "hosted setup must probe exact refs before selecting exact-only, Main-source-only, or cold fallback imports"
    );
    assert!(
        app_bake.contains("variable \"GHA_CACHE_EXACT_PROBES_COMPLETE\"")
            && setup.contains("GHA_CACHE_EXACT_PROBES_COMPLETE=1")
            && preflight_bake.contains(
                "GHA_CACHE_EXACT_PROBES_COMPLETE != \"\" && GHA_CACHE_FALLBACK_ENABLED != \"\"",
            ),
        "preflight must skip an exact ref only after hosted setup proves it absent"
    );
    for (bake_file, cache_from) in [
        (rust_bake.as_str(), "rust_base_cache_from"),
        (rust_bake.as_str(), "rust_ecosystem_dylint_cache_from"),
        (rust_bake.as_str(), "rust_ecosystem_fuzz_cache_from"),
        (rust_bake.as_str(), "rust_ecosystem_policy_tools_cache_from"),
        (
            rust_bake.as_str(),
            "rust_ecosystem_deterministic_cache_from",
        ),
        (rust_bake.as_str(), "rust_ecosystem_kani_cache_from"),
        (rust_bake.as_str(), "rust_deps_cache_from"),
        (rust_bake.as_str(), "rust_wasm_deps_cache_from"),
        (rust_bake.as_str(), "rust_native_source_cache_from"),
        (rust_bake.as_str(), "rust_wasm_source_cache_from"),
        (rust_bake.as_str(), "rust_wasm_node_cache_from"),
        (web_image.as_str(), "web_e2e_cache_from"),
        (preflight_bake.as_str(), "preflight_cache_from"),
    ] {
        assert!(
            assignment_body(bake_file, cache_from)?.contains(
                "GHA_CACHE_EXACT_PROBES_COMPLETE != \"\" && GHA_CACHE_FALLBACK_ENABLED != \"\"",
            ),
            "{cache_from} must omit a git-scoped importer after the setup probe proves that ref absent"
        );
    }
    for availability in [
        "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_DYLINT_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_FUZZ_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_POLICY_TOOLS_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_DETERMINISTIC_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_KANI_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_DEPS_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_WASM_DEPS_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_NATIVE_SOURCE_AVAILABLE",
        "GHA_CACHE_MAIN_RUST_NATIVE_SOURCE_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE",
        "GHA_CACHE_MAIN_RUST_WASM_SOURCE_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE",
        "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE",
        "GHA_CACHE_EXACT_WEB_E2E_AVAILABLE",
    ] {
        assert!(
            app_bake.contains(&format!("variable \"{availability}\""))
                && (setup.contains(&format!("publish_exact_availability {availability}"))
                    || setup.contains(&format!("publish_main_availability {availability}"))),
            "{availability} must be declared and populated by the hosted exact-ref or Main-ref probe"
        );
    }
    assert!(
        !setup.contains("scope_suffix=\"-pr-$pr_number\""),
        "PR cache scope must not use -pr-<number> suffixes"
    );
    assert!(
        setup.contains("pull_request.head.sha"),
        "PR cache scope must key by pull-request head SHA, not merge GITHUB_SHA"
    );

    // Main trusted path: empty suffix keeps write_cache_repository on nook/buildcache.
    assert!(
        app_bake.contains("\"nook/buildcache\"")
            && app_bake.contains("\"nook/remote-buildcache\"")
            && setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"),
        "Main empty suffix and isolated -git- suffix must select distinct Zot repositories"
    );

    for name in [
        "rust_deps_cache_from",
        "rust_wasm_deps_cache_from",
        "rust_native_source_cache_from",
        "rust_wasm_source_cache_from",
        "rust_wasm_node_cache_from",
    ] {
        let body = assignment_body(&rust_bake, name)?;
        assert!(
            body.contains("ignore-error=true"),
            "{name} cold cache-from must tolerate missing isolated refs"
        );
    }
    for name in [
        "rust_deps_cache_to",
        "rust_wasm_deps_cache_to",
        "rust_native_source_cache_to",
        "rust_wasm_source_cache_to",
        "rust_wasm_node_cache_to",
        "rust_base_cache_to",
    ] {
        let body = assignment_body(&rust_bake, name)?;
        assert!(
            !body.contains("ignore-error"),
            "{name} must fail the job when cook-layer export fails"
        );
    }
    Ok(())
}

#[test]
fn theorem_hive_arc_pr_reuses_local_state_without_exact_export() -> anyhow::Result<()> {
    let root = repository_root();
    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    let workflow = read(&root, ".github/workflows/hive.yml");
    let tasks = read(&root, "agentic-ai/minds/hive/Taskfile.yml");

    assert!(
        setup.contains("HIVE_CACHE_FROM=$hive_remote_ref")
            && setup.contains("HIVE_CACHE_SEED_FROM=$hive_seed")
            && setup.contains("HIVE_CACHE_TO=$hive_remote_ref,mode=max,timeout=15m")
            && setup.contains("Exact Hive cache available; Main seed suppressed")
            && !setup.contains("if [ \"$event_name\" != \"pull_request\" ]; then"),
        "isolated PR setup must use exact Hive alone when present, otherwise Main, and publish only the exact SHA"
    );
    assert!(
        workflow.contains("uses: ./.github/actions/nook-docker-setup")
            && workflow.contains("runs-on: nook-k0s-hive")
            && workflow.contains(
                "main-cache-only: ${{ github.event_name == 'pull_request' && 'true' || 'false' }}"
            )
            && workflow.contains("isolated-cache-write: \"false\"")
            && tasks.contains("${NOOK_ARC_HIVE:-}"),
        "trusted Hive verification must use its ARC scale set, restore Main only as a fallback, and avoid per-PR registry export"
    );
    let verify = taskfile_task_body(&tasks, "verify")?;
    assert!(
        verify.contains("--cache-from \"$HIVE_CACHE_FROM\"")
            && verify.contains("--cache-from \"$HIVE_CACHE_SEED_FROM\"")
            && verify.contains("--cache-to \"$HIVE_CACHE_TO\""),
        "Hive verification must retain optional exact/Main importer and exporter capabilities for hosted fallback and Main publication"
    );
    assert!(
        workflow.contains("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")
            && workflow.contains("nook/buildcache/nook-hive-linux-amd64-v1")
            && workflow.matches("Publish verified Hive cache").count() == 2
            && workflow.contains("verify-hosted:")
            && workflow.contains("Connect hosted BuildKit cache")
            && workflow.contains("verify-fork:")
            && workflow.contains("Set up untrusted cache-free BuildKit")
            && workflow.matches("uses: oven-sh/setup-bun@v2").count() == 3
            && workflow.matches("HIVE_CACHE_FROM: \"\"").count() == 1,
        "trusted Main must publish from ARC or hosted fallback, while untrusted PRs remain cache-free"
    );
    Ok(())
}

#[test]
fn theorem_product_source_leaves_use_one_internal_dockerfile_lineage() -> anyhow::Result<()> {
    let root = repository_root();
    let tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let core_bake = read(&root, "nook-app/nook-platform/nook-core/docker-bake.hcl");
    let wasm_bake = read(&root, "nook-app/nook-platform/nook-wasm/docker-bake.hcl");
    let product = read(
        &root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    let native = taskfile_task_body(&tasks, "docker:ci:rust:export")?;
    let export = taskfile_task_body(&tasks, "docker:ci:wasm:export")?;

    assert!(
        native.contains("ci-rust'")
            && !native.contains("builder-core-deps.output=type=cacheonly")
            && !native.contains("rust-base-restore.output=type=cacheonly")
            && !native.contains("ci-rust builder-core-deps"),
        "native verification must request only its source-leaf group"
    );
    assert!(
        export.contains("wasm-export.output=type=local") && export.contains("wasm-export'"),
        "WASM verification must request the artifact leaf"
    );
    assert!(
        !export.contains("builder-wasm-deps.output=type=cacheonly")
            && !export.contains("wasm-export builder-wasm-deps"),
        "WASM verification must not request a dependency sibling"
    );
    for stage in [
        "FROM rust-base AS chef-deps",
        "FROM chef-deps AS builder-wasm-deps",
        "FROM builder-wasm-deps AS builder-core-deps",
        "FROM builder-core-deps AS builder-debug",
        "FROM builder-wasm-deps AS builder-wasm-source",
        "FROM builder-wasm-build AS focused-web-artifacts-source",
        "FROM rust-platform AS rust-ecosystem-deterministic",
        "FROM rust-base AS rust-kani-toolchain",
        "FROM rust-kani-toolchain AS rust-kani",
    ] {
        assert!(
            product.contains(stage),
            "self-contained product lineage is missing stage: {stage}"
        );
    }
    for (bake, targets) in [
        (
            core_bake.as_str(),
            &[
                "builder-core-deps",
                "builder-wasm-deps",
                "rust-platform",
                "builder-debug",
                "coverage-export",
                "_nook-rust-test-common",
                "_nook-rust-lint-common",
                "_nook-rust-coverage-common",
            ][..],
        ),
        (
            wasm_bake.as_str(),
            &[
                "builder-wasm",
                "_nook-rust-fast-common",
                "rust-format-check",
                "wasm-export",
                "focused-web-artifacts",
                "web-artifacts",
                "_nook-rust-common",
                "_nook-rust-browser-common",
            ][..],
        ),
        (
            rust_bake.as_str(),
            &["rust-base", "rust-ecosystem-deterministic", "rust-kani"][..],
        ),
    ] {
        for target in targets {
            let body = bake_target_body(bake, target);
            assert!(
                body.contains(
                    "dockerfile = \"nook-app/nook-platform/docker/rust/product.Dockerfile\"",
                ) && !body.contains("contexts ="),
                "product target {target} must use the internal product Dockerfile without a Bake-linked parent"
            );
        }
    }
    Ok(())
}
