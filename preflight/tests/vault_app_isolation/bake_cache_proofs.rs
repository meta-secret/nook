//! Formal static Bake cache proofs for GitHub Actions + Zot.
//!
//! These theorems encode the restore/publish graph that keeps chef cooks CACHED.
//! Runtime CACHED proof for WASM deps remains Main `verify-wasm-gha-cache.sh`.

use super::*;
use anyhow::{Context, bail};
use std::collections::{BTreeSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

const WASM_FINGERPRINT_ALLOWLIST: &[&str] = &[
    "nook-app/nook-platform/Cargo.toml",
    "nook-app/nook-platform/Cargo.lock",
    "nook-app/**/Cargo.toml",
    "nook-app/nook-platform/.cargo/**",
    "nook-app/nook-platform/.config/**",
    "nook-app/nook-platform/clippy.toml",
    "nook-app/nook-platform/docker/rust/lineage.Dockerfile",
    "nook-app/nook-platform/docker/rust/lineage.Dockerfile.dockerignore",
    "nook-app/nook-platform/docker/sccache-wrapper.sh",
    "nook-app/nook-platform/docker/sccache-report.sh",
];

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
        "rust_ecosystem_nightly_cache_from",
        &["nook-rust-ecosystem-nightly-v4"],
        &[],
        &["nook-rust-base-v1"],
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
        &preflight_bake,
        "preflight_cache_from",
        &["nook-preflight-v1"],
        &[],
        &["nook-rust-base-v1"],
    )?;
    Ok(())
}

#[test]
fn theorem_ecosystem_parent_fallback_restores_main() -> anyhow::Result<()> {
    let root = repository_root();
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    for (name, main_ref, git_marker) in [
        (
            "rust_ecosystem_nightly_cache_from",
            "nook/buildcache/nook-rust-ecosystem-nightly-v4",
            "nook-rust-ecosystem-nightly-v4${GHA_CACHE_SCOPE_SUFFIX}",
        ),
        (
            "rust_ecosystem_policy_tools_cache_from",
            "nook/buildcache/nook-rust-ecosystem-policy-tools-v4",
            "nook-rust-ecosystem-policy-tools-v4${GHA_CACHE_SCOPE_SUFFIX}",
        ),
        (
            "rust_ecosystem_dylint_cache_from",
            "nook/buildcache/nook-rust-ecosystem-dylint-v3",
            "nook-rust-ecosystem-dylint-v3${GHA_CACHE_SCOPE_SUFFIX}",
        ),
        (
            "rust_ecosystem_fuzz_cache_from",
            "nook/buildcache/nook-rust-ecosystem-fuzz-v3",
            "nook-rust-ecosystem-fuzz-v3${GHA_CACHE_SCOPE_SUFFIX}",
        ),
    ] {
        let body = assignment_body(&rust_bake, name)?;
        let (fallback, non_fallback) = split_fallback_arms(body)?;
        assert!(
            fallback.contains(main_ref),
            "{name} FALLBACK must restore Main {main_ref}"
        );
        assert!(
            !non_fallback.contains(main_ref),
            "{name} non-FALLBACK must not hardcode Main {main_ref}"
        );
        let main_idx = fallback
            .find(main_ref)
            .with_context(|| format!("{name} FALLBACK missing Main {main_ref}"))?;
        let git_idx = fallback
            .find(git_marker)
            .with_context(|| format!("{name} FALLBACK missing git-scope {git_marker}"))?;
        assert!(
            main_idx < git_idx,
            "{name} FALLBACK must restore fat Main before git-scope"
        );
    }
    Ok(())
}

#[test]
fn theorem_dylint_publishes_nightly_after_leaf_materialize() -> anyhow::Result<()> {
    let root = repository_root();
    let docker_tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let dylint = taskfile_task_body(&docker_tasks, "docker:ecosystem:dylint")?;
    let verify_idx = dylint
        .find("docker:ecosystem:nightly:verify")
        .context("dylint must warm nightly:verify")?;
    let leaf_idx = dylint
        .find("rust-dylint")
        .context("dylint must bake rust-dylint")?;
    let publish_idx = dylint
        .find("rust-ecosystem-nightly-publish")
        .context("dylint must publish nightly after leaf materialize")?;
    assert!(
        verify_idx < leaf_idx && leaf_idx < publish_idx,
        "dylint must verify, bake leaf, then publish nightly (not publish-before-leaf)"
    );
    assert!(
        !dylint.lines().any(|line| {
            let trimmed = line.trim();
            trimmed == "task: docker:ecosystem:nightly"
                || trimmed == "- task: docker:ecosystem:nightly"
        }),
        "dylint must not call full docker:ecosystem:nightly (publishes before leaf)"
    );
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

    let nightly_restore =
        bake_target_body(rust_bake.as_str(), "rust-ecosystem-nightly-restore");
    assert!(
        nightly_restore.contains("cache-from = rust_ecosystem_nightly_cache_from")
            && !bake_target_assigns_cache_to(
                rust_bake.as_str(),
                "rust-ecosystem-nightly-restore",
            ),
        "nightly restore must import its own scope without writing"
    );
    assert!(
        !rust_bake.contains("rust-platform-nightly")
            && !rust_bake.contains("rust-ecosystem-nightly = \"target:rust-ecosystem-nightly\"")
            && rust_bake
                .matches("dockerfile = \"nook-app/nook-platform/docker/rust/nightly.Dockerfile\"")
                .count()
                == 3,
        "nightly/dylint/fuzz must share one Dockerfile with no linked nightly context"
    );

    for (bake, target) in [
        (core_bake.as_str(), "builder-core-deps"),
        (core_bake.as_str(), "builder-wasm-deps"),
        (web_toolchain.as_str(), "web-deps"),
    ] {
        let body = bake_target_body(bake, target);
        assert!(
            !body.trim().is_empty(),
            "context parent target {target} must exist"
        );
        assert!(
            body.lines()
                .any(|line| line.trim_start().starts_with("cache-from")),
            "context parent {target} must declare cache-from"
        );
        assert!(
            !bake_target_assigns_cache_to(bake, target),
            "context parent {target} must never declare cache-to"
        );
    }

    for (bake, target, cache_to_var) in [
        (
            rust_bake.as_str(),
            "rust-base-publish",
            "rust_base_cache_to",
        ),
        (
            rust_bake.as_str(),
            "rust-ecosystem-nightly-publish",
            "rust_ecosystem_nightly_cache_to",
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
        "PR/Remote isolated writes must use -git-<40-char head SHA> with Main fallback enabled"
    );
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
fn theorem_wasm_fingerprint_closed_allowlist() -> anyhow::Result<()> {
    let root = repository_root();
    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    let fingerprint_call = setup
        .split_once("wasm_deps_fingerprint=\"${{ hashFiles(")
        .context("docker setup must compute wasm_deps_fingerprint via hashFiles")?
        .1
        .split_once(") }}\"")
        .context("docker setup hashFiles call must terminate")?
        .0;
    let actual = parse_hashfiles_args(fingerprint_call)?;
    let expected: BTreeSet<&str> = WASM_FINGERPRINT_ALLOWLIST.iter().copied().collect();
    assert_eq!(
        actual, expected,
        "WASM deps fingerprint must equal the cook-only allowlist (got {actual:?})"
    );
    assert!(
        setup.contains("GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-v5-$wasm_deps_fingerprint"),
        "fingerprinted scope must remain nook-rust-wasm-deps-v5-<hash>"
    );
    Ok(())
}

#[test]
fn theorem_wasm_and_native_publish_staging() -> anyhow::Result<()> {
    let root = repository_root();
    let docker_tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let verifier = read(&root, ".github/scripts/verify-wasm-gha-cache.sh");

    let native = docker_tasks
        .split("docker:ci:cache:publish:native:")
        .nth(1)
        .and_then(|tail| tail.split("docker:ci:cache:publish:wasm:").next())
        .context("native publish task missing")?;
    let native_base = native
        .find("task: docker:ci:cache:publish:rust-base")
        .context("native publish must stage rust-base")?;
    let native_deps = native
        .find("builder-core-deps-publish builder-debug")
        .context("native publish must bake deps/debug")?;
    let native_preflight = native
        .find("preflight-test")
        .context("native publish must bake preflight-test")?;
    assert!(
        native_base < native_deps && native_deps < native_preflight,
        "native publish must stage rust-base, then deps/debug, then preflight"
    );

    let wasm = docker_tasks
        .split("docker:ci:cache:publish:wasm:")
        .nth(1)
        .and_then(|tail| tail.split("docker:rust-base:").next())
        .context("wasm publish task missing")?;
    let wasm_deps = wasm
        .find("builder-wasm-deps-publish")
        .context("wasm publish must bake builder-wasm-deps-publish")?;
    let wasm_source = wasm
        .find("wasm-export")
        .context("wasm publish must bake wasm-export")?;
    let wasm_base = wasm
        .find("task: docker:ci:cache:publish:rust-base")
        .context("wasm publish must seed rust-base after deps/source")?;
    assert!(
        wasm_deps < wasm_source && wasm_source < wasm_base,
        "wasm publish must stage deps-publish, then source export, then rust-base"
    );
    assert!(
        wasm.contains("verify-wasm-gha-cache.sh") && wasm.contains("GHA_CACHE_SCOPE_SUFFIX"),
        "Main WASM publish must invoke the fresh-builder fingerprint verifier"
    );

    assert!(
        verifier.contains("docker-container")
            && verifier.contains("--use")
            && !verifier.contains("--builder")
            && verifier.contains("builder-wasm-deps.cache-from=type=registry")
            && verifier.contains("nook-sccache-report chef-wasm-release")
            && verifier.contains("nook-sccache-report chef-wasm-clippy")
            && verifier.contains("nook-sccache-report wasm-release-test-dependencies"),
        "runtime WASM proof must use a fresh docker-container builder and require chef CACHED markers"
    );
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

fn taskfile_task_body<'a>(tasks: &'a str, name: &str) -> anyhow::Result<&'a str> {
    let marker = format!("  {name}:");
    let rest = tasks
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .with_context(|| format!("missing Taskfile task {name}"))?;
    let mut end = rest.len();
    for (idx, _) in rest.match_indices('\n') {
        let line = rest[idx + 1..].lines().next().unwrap_or("");
        if line.starts_with("  ")
            && !line.starts_with("   ")
            && line.trim_end().ends_with(':')
            && !line.trim_start().starts_with('#')
        {
            end = idx;
            break;
        }
    }
    Ok(rest[..end].trim())
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

fn parse_hashfiles_args(call: &str) -> anyhow::Result<BTreeSet<&str>> {
    let mut args = BTreeSet::new();
    for part in call.split(',') {
        let trimmed = part.trim();
        let path = trimmed
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .with_context(|| format!("hashFiles arg must be single-quoted: {trimmed}"))?;
        if !args.insert(path) {
            bail!("duplicate hashFiles path {path}");
        }
    }
    Ok(args)
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
