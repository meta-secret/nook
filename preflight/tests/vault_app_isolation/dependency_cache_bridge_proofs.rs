//! Proofs for sharing source-free Rust dependency caches between local format
//! setup, trusted Main, and isolated pull-request jobs.

use super::*;
use anyhow::Context;
use std::process::Command;

const WASM_FINGERPRINT_ALLOWLIST: &[&str] = &[
    ".github/scripts/rust-deps-cache-fingerprint.sh",
    "nook-app/nook-platform/Cargo.toml",
    "nook-app/nook-platform/Cargo.lock",
    "nook-app/**/Cargo.toml",
    "nook-app/nook-platform/.cargo/**",
    "nook-app/nook-platform/.config/**",
    "nook-app/nook-platform/clippy.toml",
    "nook-app/nook-platform/docker/rust/product.Dockerfile",
    "nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore",
    "nook-app/nook-platform/docker/sccache-wrapper.sh",
    "nook-app/nook-platform/docker/sccache-report.sh",
];

#[test]
fn theorem_local_formatter_and_pr_share_input_cache() -> anyhow::Result<()> {
    let root = repository_root();
    let root_tasks = read(&root, "Taskfile.yml");
    let app_tasks = read(&root, "nook-app/Taskfile.yml");
    let docker_tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let guard = read(&root, ".github/scripts/rust-deps-cache-publish-guard.sh");
    let promoter = read(&root, ".github/scripts/rust-deps-cache-promote.sh");
    let promotion_workflow = read(&root, ".github/workflows/remote.yml");
    let hosted_setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let core_bake = read(&root, "nook-app/nook-platform/nook-core/docker-bake.hcl");

    assert!(
        root_tasks.contains("NOOK_REGISTRY_CACHE_LOCAL_DEPS_PUBLISH:")
            && root_tasks.contains("NOOK_RUST_DEPS_INPUT_FINGERPRINT:")
            && !root_tasks
                .split_once("NOOK_REGISTRY_CACHE_LOCAL_DEPS_PUBLISH:")
                .context("local deps publish env missing")?
                .1
                .lines()
                .take(4)
                .any(|line| line.contains("git status --porcelain"))
            && guard.contains("rust-deps-cache-fingerprint.sh")
            && guard.contains("git -C \"$repo_root\" diff --quiet HEAD")
            && guard.contains("cache recipe is dirty")
            && guard.contains("fingerprint must be $expected")
            && docker_tasks.contains("unsafe cache recipe; publication skipped"),
        "formatter publication must allow dirty source while rejecting a dirty cache recipe and verifying its content fingerprint"
    );

    let setup = taskfile_task_body(&app_tasks, "setup")?;
    let solve = setup
        .find("buildx bake --allow=fs.write")
        .context("local setup must solve its Rust/WASM graph")?;
    let publish = setup
        .find("task: registry-cache:publish:local-format-deps")
        .context("local formatter setup must publish its completed dependency graph")?;
    assert!(
        solve < publish,
        "local formatter may publish dependency layers only after its sealed build succeeds"
    );

    let local_publish =
        taskfile_task_body(&docker_tasks, "registry-cache:publish:local-format-deps")?;
    for marker in [
        "rust-deps-cache-publish-guard.sh",
        "NOOK_RUST_DEPS_INPUT_WRITE_ENABLED=1",
        "NOOK_RUST_DEPS_INPUT_CANDIDATE=\"$candidate\"",
        "builder-wasm-deps-input-publish",
        "builder-core-deps-input-publish",
        "gh workflow run remote.yml",
        "task=rust-cache:promote",
        "--ref main",
    ] {
        assert!(
            local_publish.contains(marker),
            "local formatter dependency publisher is missing {marker}"
        );
    }
    assert!(
        !local_publish.contains("builder-debug")
            && !local_publish.contains("wasm-export")
            && !local_publish.contains("preflight-test"),
        "dirty formatter publication must never export real source or validation layers"
    );
    for graph in ["native", "wasm"] {
        let repository = format!("nook-rust-{graph}-deps-input-v2");
        let stable = format!("{repository}:fingerprint-${{NOOK_RUST_DEPS_INPUT_FINGERPRINT}}");
        let candidate = format!(
            "{repository}:candidate-${{NOOK_RUST_DEPS_INPUT_FINGERPRINT}}-${{NOOK_RUST_DEPS_INPUT_CANDIDATE}}"
        );
        assert!(
            rust_bake.contains(&stable)
                && rust_bake.contains(&candidate)
                && rust_bake.contains(&format!("{candidate},mode=max"))
                && rust_bake.matches(&stable).count() == 4,
            "quarantined dependency publication and verified restore are missing for {graph}"
        );
    }
    assert!(
        !rust_bake.contains("deps-input-v1-") && rust_bake.matches(":candidate-").count() == 2,
        "PR restores must never import legacy or unverified local candidate refs"
    );
    assert!(
        core_bake.contains("target \"builder-core-deps-input-publish\"")
            && core_bake.contains("inherits = [\"builder-core-deps-restore\"]")
            && core_bake.contains("target \"builder-wasm-deps-input-publish\"")
            && core_bake.contains("inherits = [\"builder-wasm-deps-restore\"]"),
        "dirty-safe publishers must inherit only source-free dependency stages"
    );
    assert!(
        hosted_setup.contains(
            "rust_deps_fingerprint=\"$(bash .github/scripts/rust-deps-cache-fingerprint.sh)\""
        ) && hosted_setup.contains("NOOK_RUST_DEPS_INPUT_FINGERPRINT=$rust_deps_fingerprint"),
        "PR jobs must derive and import the identical formatter dependency fingerprint"
    );
    for marker in [
        "oras cp --to-oci-layout \"$repository:$candidate_tag\"",
        "oras cp --from-oci-layout",
        "oras cp --to-oci-layout \"$repository:$verified_tag\"",
        "oras tag \"$repository:$verified_tag\" \"$stable_tag\"",
        "stable tag does not match verified content",
    ] {
        assert!(
            promoter.contains(marker),
            "hosted byte-validation promoter is missing {marker}"
        );
    }
    assert!(
        promotion_workflow.contains("workflow_dispatch:")
            && promotion_workflow.contains("oras-project/setup-oras@v2")
            && promotion_workflow.contains("version: 1.3.3")
            && promotion_workflow.contains("NOOK_REGISTRY_REMOTE_USERNAME")
            && promotion_workflow.contains("rust-deps-cache-promote.sh")
            && promotion_workflow
                .contains("PROMOTION_FINGERPRINT: ${{ inputs.cache_fingerprint }}")
            && promotion_workflow.contains("PROMOTION_SOURCE_SHA: ${{ inputs.cache_source_sha }}")
            && promotion_workflow.contains("git -C candidate-source rev-parse HEAD")
            && promotion_workflow
                .contains("NOOK_RUST_DEPS_FINGERPRINT_ROOT=\"$GITHUB_WORKSPACE/candidate-source\"")
            && !promotion_workflow.contains("promote.sh \"${{ inputs.")
            && promotion_workflow.contains("Remote / rust-cache:promote"),
        "local candidates must be validated and promoted by the allowlisted hosted workflow"
    );
    assert!(
        guard.contains(".github/scripts/rust-deps-cache-promote.sh")
            && guard.contains(".github/workflows/remote.yml"),
        "dirty promotion policy must prevent local publication"
    );
    Ok(())
}

#[test]
fn theorem_loom_release_dependencies_are_source_free_and_main_seeded() {
    let root = repository_root();
    let product = read(
        &root,
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
    );
    let dependency_boundary = product
        .find("FROM builder-core-deps AS rust-platform")
        .expect("rust-platform source boundary must exist");
    let dependency_graph = &product[..dependency_boundary];
    let source_graph = &product[dependency_boundary..];

    assert!(
        dependency_graph.contains("RUSTFLAGS='--cfg loom' cargo test --locked --release")
            && dependency_graph.contains("-p nook-replication --no-run")
            && dependency_graph
                .contains("nook-sccache-report native-replication-loom-release-dependencies"),
        "builder-core-deps must warm the cfg(loom) release graph before real Rust sources are copied"
    );
    assert!(
        source_graph.contains("FROM rust-platform AS rust-ecosystem-deterministic")
            && source_graph.contains(
                "RUSTFLAGS='--cfg loom' cargo test --locked -p nook-replication loom_tests --release"
            ),
        "the deterministic source leaf must execute the real Loom test after restoring its dependency graph"
    );
}

#[test]
fn theorem_wasm_node_consumer_owns_exact_cache() -> anyhow::Result<()> {
    let root = repository_root();
    let app_bake = read(&root, "nook-app/docker-bake.hcl");
    let rust_bake = read(&root, "nook-app/nook-platform/docker/rust/docker-bake.hcl");
    let wasm_bake = read(&root, "nook-app/nook-platform/nook-wasm/docker-bake.hcl");
    let tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    let main = read(&root, ".github/workflows/main.yml");
    let pr = read(&root, ".github/workflows/pr.yml");

    let builder = bake_target_body(&wasm_bake, "builder-wasm");
    assert!(
        builder.contains("target     = \"builder-wasm\"")
            && builder.contains("cache-from = rust_wasm_node_cache_from")
            && builder.contains("cache-to   = rust_wasm_node_cache_to")
            && !builder.contains("rust_wasm_source_cache_to"),
        "WASM Node tests must own a full-graph scope distinct from the parallel WASM source writer"
    );
    let node_task = taskfile_task_body(&tasks, "docker:ci:wasm:node-test")?;
    assert!(
        node_task.contains("builder-wasm.output=type=cacheonly")
            && node_task.contains("builder-wasm"),
        "the Node-test task must finish the cache-owning builder-wasm target"
    );
    assert!(
        app_bake.contains("variable \"GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE\"")
            && setup.contains(
                "publish_exact_availability GHA_CACHE_EXACT_RUST_WASM_NODE_AVAILABLE \"nook-rust-wasm-node-v1$scope_suffix\""
            )
            && rust_bake.contains("nook/buildcache/nook-rust-wasm-node-v1")
            && rust_bake.contains("nook-rust-wasm-node-v1${GHA_CACHE_SCOPE_SUFFIX}"),
        "hosted setup must select exact-only Node restore or trusted Main fallback"
    );
    let main_node = section(
        &main,
        "      - name: WASM Node tests\n",
        "      - name: Publish verified WASM BuildKit cache\n",
    );
    let pr_node = section(&pr, "  wasm-node-test:\n", "  verify:\n");
    let ci_tasks = read(&root, "nook-app/ci/Taskfile.yml");
    assert!(
        main_node.contains("task ci:main:wasm-node-test")
            && !main_node.contains("GHA_CACHE_WRITE_ENABLED: \"1\"")
            && ci_tasks.contains("ci:main:wasm-node-test:")
            && ci_tasks.contains("GHA_CACHE_WRITE_ENABLED= task ci:wasm:node-test")
            && ci_tasks.contains("GHA_CACHE_WRITE_ENABLED=1 task ci:wasm:node-test")
            && pr_node.contains("isolated-cache-write: \"true\"")
            && pr_node.contains("GHA_CACHE_WRITE_ENABLED=\"\" task ci:wasm:node-test")
            && pr_node.contains("GHA_CACHE_WRITE_ENABLED=1 task ci:wasm:node-test"),
        "trusted Main and hosted PR fallback must retain publication without exporting WASM Node graphs from ARC"
    );
    Ok(())
}

#[test]
fn theorem_wasm_fingerprint_closed_allowlist() -> anyhow::Result<()> {
    let root = repository_root();
    let setup = read(&root, ".github/actions/nook-docker-setup/action.yml");
    let script = read(&root, ".github/scripts/rust-deps-cache-fingerprint.sh");
    for input in WASM_FINGERPRINT_ALLOWLIST {
        let marker = if input.contains("/**") {
            format!("'{input}'")
        } else {
            (*input).to_owned()
        };
        assert!(
            script.contains(&marker),
            "Rust dependency fingerprint is missing cook input {input}"
        );
    }
    assert!(
        !script.contains("Taskfile.yml")
            && !script.contains("docker-bake.hcl")
            && !script.contains("src/"),
        "dependency fingerprint must exclude orchestration and real source files"
    );
    let script_path = root.join(".github/scripts/rust-deps-cache-fingerprint.sh");
    let syntax = Command::new("bash")
        .arg("-n")
        .arg(&script_path)
        .output()
        .context("failed to parse Rust dependency fingerprint")?;
    assert!(
        syntax.status.success(),
        "dependency fingerprint script must be valid shell"
    );
    // The sealed preflight image intentionally excludes `.git`. The composite
    // setup action executes this script in every real GitHub checkout, while a
    // source checkout can additionally prove the exact output contract here.
    if root.join(".git").exists() {
        let output = Command::new("bash")
            .arg(script_path)
            .current_dir(&root)
            .output()
            .context("failed to execute Rust dependency fingerprint")?;
        assert!(
            output.status.success(),
            "dependency fingerprint script failed"
        );
        let fingerprint = String::from_utf8(output.stdout)?.trim().to_owned();
        assert!(
            fingerprint.len() == 40
                && fingerprint
                    .chars()
                    .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "dependency fingerprint must be a 40-char lowercase git object ID"
        );
    }
    assert!(
        setup.contains("GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-v5-$rust_deps_fingerprint"),
        "fingerprinted scope must remain nook-rust-wasm-deps-v5-<hash>"
    );
    assert!(
        script.contains("nook-rust-deps-input-v2") && !script.contains("nook-rust-deps-input-v1"),
        "dependency fingerprint domain must rotate with the verified v2 bridge"
    );
    assert!(
        script.contains("NOOK_RUST_DEPS_FINGERPRINT_ROOT"),
        "trusted Main promotion must be able to fingerprint an exact committed candidate checkout"
    );
    Ok(())
}

#[test]
fn theorem_wasm_and_native_publish_staging() -> anyhow::Result<()> {
    let root = repository_root();
    let docker_tasks = read(&root, "nook-app/nook-platform/docker/Taskfile.yml");
    let verifier = read(&root, ".github/scripts/verify-wasm-gha-cache.sh");
    let core_bake = read(&root, "nook-app/nook-platform/nook-core/docker-bake.hcl");

    let native = docker_tasks
        .split("docker:ci:cache:publish:native:")
        .nth(1)
        .and_then(|tail| tail.split("docker:ci:cache:publish:wasm:").next())
        .context("native publish task missing")?;
    let native_base = native
        .find("task: docker:ci:cache:publish:rust-base")
        .context("native publish must stage rust-base")?;
    let native_deps = native
        .find("builder-core-deps-publish")
        .context("native publish must bake deps")?;
    let native_source = native
        .find("builder-debug")
        .context("native publish must bake source")?;
    let native_preflight = native
        .find("preflight-test")
        .context("native publish must bake preflight-test")?;
    assert!(
        native_base < native_deps
            && native_deps < native_source
            && native_source < native_preflight,
        "native publish must stage rust-base, deps, source, then preflight as separate solves"
    );

    let wasm = docker_tasks
        .split("docker:ci:cache:publish:wasm:")
        .nth(1)
        .and_then(|tail| tail.split("docker:rust-base:").next())
        .context("wasm publish task missing")?;
    let wasm_source = wasm
        .find("wasm-export")
        .context("wasm publish must bake wasm-export")?;
    let wasm_base = wasm
        .find("task: docker:ci:cache:publish:rust-base")
        .context("wasm publish must seed rust-base after deps/source")?;
    assert!(
        wasm_source < wasm_base && !wasm.contains("builder-wasm-deps-publish"),
        "ARC WASM publish must stage source then rust-base without overwriting the portable dependency ref"
    );
    assert!(
        !wasm.contains("verify-wasm-gha-cache.sh"),
        "ARC WASM publish must leave portable dependency publication to the hosted writer/proof job"
    );

    assert!(
        core_bake.contains("target \"builder-wasm-deps-cache-proof\"")
            && core_bake.contains("inherits   = [\"builder-wasm-deps-restore\"]")
            && core_bake.contains("target     = \"builder-wasm-deps\"")
            && !core_bake.contains("wasm-deps = \"target:builder-wasm-deps-restore\""),
        "the hosted writer/proof must preserve the product Dockerfile/context cache-key lineage without a hydration-only stage"
    );
    assert!(
        verifier.contains("docker-container")
            && verifier.contains("--use")
            && !verifier.contains("--builder")
            && verifier.contains("builder-wasm-deps-cache-proof.cache-from=type=registry")
            && verifier.contains("builder-wasm-deps-cache-proof.output=type=cacheonly")
            && verifier.contains("builder-wasm-deps-cache-proof.cache-to=$cache_to")
            && verifier.contains("NOOK_WASM_CACHE_PROMOTION_ENABLED")
            && verifier.contains("refs/heads/main")
            && verifier.contains("nook-sccache-report chef-wasm-release")
            && verifier.contains("nook-sccache-report chef-wasm-clippy")
            && verifier.contains("nook-sccache-report wasm-release-test-dependencies"),
        "runtime WASM proof must publish on trusted Main with one fresh hosted builder and require CACHED markers from another"
    );
    Ok(())
}
