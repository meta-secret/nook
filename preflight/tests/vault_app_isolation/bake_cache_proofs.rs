//! Formal static Bake cache proofs for GitHub Actions + Zot.
//!
//! These theorems encode the restore/publish graph that keeps chef cooks CACHED.
//! Runtime CACHED proof for WASM deps remains Main `verify-wasm-gha-cache.sh`.

use super::*;
use anyhow::Context;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

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
        ".github/workflows/source-architecture.yml",
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
    ] {
        let body = assignment_body(bake, name)?;
        let exact = split_exact_available_arm(body, availability)?;
        assert!(
            exact.contains(exact_marker) && !exact.contains(main_ref),
            "{name} must import only its exact full-graph ref when {availability} is set"
        );
        let (fallback, _) = split_fallback_arms(body)?;
        assert!(
            fallback.contains(main_ref),
            "{name} FALLBACK must restore Main {main_ref}"
        );
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
            body.contains("mode=max") && body.contains("${write_cache_repository}"),
            "{name} must write mode=max under write_cache_repository"
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
            && setup.contains("cache-from entries are merged, not ordered")
            && setup.contains("Exact cache absent; Main/fingerprint fallback enabled"),
        "hosted setup must probe exact refs before selecting exact-only or cold fallback imports"
    );
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
        "GHA_CACHE_EXACT_RUST_WASM_SOURCE_AVAILABLE",
        "GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE",
        "GHA_CACHE_EXACT_PREFLIGHT_AVAILABLE",
    ] {
        assert!(
            app_bake.contains(&format!("variable \"{availability}\""))
                && setup.contains(&format!("publish_exact_availability {availability}")),
            "{availability} must be declared and populated by the hosted exact-ref probe"
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
fn theorem_hive_pr_publishes_only_exact_head_cache() -> anyhow::Result<()> {
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
            && workflow.contains("Docker setup for isolated PR cache")
            && workflow.contains("cache-write: \"false\"")
            && workflow.contains("main-cache-only: \"true\"")
            && workflow.contains("isolated-cache-write: \"true\""),
        "Hive PR verification must opt into the same isolated exact-head cache contract as every other Docker job"
    );
    let verify = taskfile_task_body(&tasks, "verify")?;
    assert!(
        verify.contains("--cache-from \"$HIVE_CACHE_FROM\"")
            && verify.contains("--cache-from \"$HIVE_CACHE_SEED_FROM\"")
            && verify.contains("--cache-to \"$HIVE_CACHE_TO\""),
        "Hive verification must consume the setup-selected exact-or-Main cache and publish the verified exact graph"
    );
    assert!(
        workflow.contains("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")
            && workflow.contains("nook/buildcache/nook-hive-linux-amd64-v1"),
        "only trusted Main may publish the shared Hive seed"
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

fn assert_scope_arms(
    bake: &str,
    name: &str,
    required_all: &[&str],
    required_any: &[&[&str]],
    forbidden: &[&str],
) -> anyhow::Result<()> {
    let body = assignment_body(bake, name)?;
    let (fallback, non_fallback) = split_fallback_arms(body)
        .with_context(|| format!("{name} must define FALLBACK and non-FALLBACK registry arms"))?;
    for (label, arm) in [("FALLBACK", fallback), ("non-FALLBACK", non_fallback)] {
        for token in required_all {
            assert!(
                arm.contains(token),
                "{name} {label} arm must restore {token}"
            );
        }
        for group in required_any {
            assert!(
                group.iter().any(|token| arm.contains(token)),
                "{name} {label} arm must restore one of {group:?}"
            );
        }
        for token in forbidden {
            assert!(
                !arm.contains(token),
                "{name} {label} arm must not import short/forbidden parent {token}"
            );
        }
    }
    Ok(())
}

fn assignment_body<'a>(bake: &'a str, name: &str) -> anyhow::Result<&'a str> {
    let marker = format!("{name} =");
    let rest = bake
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .with_context(|| format!("missing Bake assignment {name}"))?;
    let mut end = rest.len();
    for (idx, _) in rest.match_indices('\n') {
        let line = rest[idx + 1..].lines().next().unwrap_or("");
        if line.starts_with("target \"") {
            end = idx;
            break;
        }
        if let Some((ident, _)) = line.split_once(" =")
            && !ident.is_empty()
            && ident.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            end = idx;
            break;
        }
    }
    Ok(rest[..end].trim())
}

fn split_fallback_arms(body: &str) -> anyhow::Result<(&str, &str)> {
    const FALLBACK_MARK: &str = "GHA_CACHE_FALLBACK_ENABLED != \"\" ? [";
    const ARM_SPLIT: &str = "] : [";
    let after = body
        .split_once(FALLBACK_MARK)
        .map(|(_, rest)| rest)
        .context("missing GHA_CACHE_FALLBACK_ENABLED ternary")?;
    let (fallback, rest) = after
        .split_once(ARM_SPLIT)
        .context("missing FALLBACK / non-FALLBACK arm split")?;
    let non_fallback = rest
        .rsplit_once(']')
        .map(|(arm, _)| arm)
        .context("non-FALLBACK arm must close with ]")?;
    Ok((fallback.trim(), non_fallback.trim()))
}

fn split_exact_available_arm<'a>(body: &'a str, availability: &str) -> anyhow::Result<&'a str> {
    let marker = format!("{availability} != \"\" ? [");
    let after = body
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .with_context(|| format!("missing exact-availability ternary for {availability}"))?;
    let exact = after
        .split_once("] : GHA_CACHE_FALLBACK_ENABLED")
        .map(|(arm, _)| arm)
        .with_context(|| format!("exact arm for {availability} must precede cold fallback"))?;
    Ok(exact.trim())
}

fn assert_no_empty_bake_cache_overrides(path: &str, text: &str) {
    for key in ["cache-from=", "cache-to="] {
        for (index, line) in text.lines().enumerate() {
            let Some(after) = line.split(key).nth(1) else {
                continue;
            };
            let rest = after.trim_start();
            let empty = rest.is_empty()
                || rest.starts_with('\\')
                || matches!(rest.chars().next(), Some('"' | '\''));
            assert!(
                !empty,
                "{path}:{} clears Bake {key}; empty cache overrides are prohibited — use scoped *-publish targets",
                index + 1
            );
        }
    }
}

fn collect_cache_caller_paths(dir: &Path, out: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    let mut queue = VecDeque::from([dir.to_path_buf()]);
    while let Some(current) = queue.pop_front() {
        for entry in fs::read_dir(&current)
            .with_context(|| format!("failed to read {}", current.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if matches!(
                    name.as_ref(),
                    "node_modules"
                        | "target"
                        | "dist"
                        | ".git"
                        | "coverage"
                        | "playwright-report"
                        | "test-results"
                ) {
                    continue;
                }
                queue.push_back(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let keep = name == "Taskfile.yml"
                || name.ends_with(".yml")
                || name.ends_with(".yaml")
                || name.ends_with(".sh");
            if keep {
                out.push(path);
            }
        }
    }
    Ok(())
}
