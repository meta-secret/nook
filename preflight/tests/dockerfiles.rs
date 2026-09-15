use nook_preflight::dockerfile_cache::DockerfileRepository;
use std::{env, path::PathBuf};

#[test]
fn dockerfiles_do_not_use_buildkit_cache_mounts() -> anyhow::Result<()> {
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );

    let violations = DockerfileRepository::new(&repository_root).dockerfile_cache_mounts()?;

    assert!(
        violations.is_empty(),
        "Dockerfile cache mounts are prohibited; use ordinary immutable Docker layers instead:\n{}",
        violations
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(())
}

#[test]
fn compile_web_creates_package_directories_before_dependency_symlinks() -> anyhow::Result<()> {
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );
    let dockerfile = std::fs::read_to_string(
        repository_root.join("nook-app/nook-platform/docker/rust/compile.Dockerfile"),
    )?;
    let directory_setup = dockerfile
        .find(concat!(
            "RUN mkdir -p \\\n",
            "      /meta-secret/nook/nook-app/nook-web/nook-vault-simple \\"
        ))
        .expect("compile-web must create package directories");
    let dependency_symlinks = dockerfile
        .find("&& ln -s nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/node_modules")
        .expect("compile-web must link shared dependencies");
    let source_copy = dockerfile
        .find("COPY . .")
        .expect("compile-web must copy the repository source");

    assert!(
        dockerfile[directory_setup..dependency_symlinks]
            .contains("/meta-secret/nook/nook-app/nook-web/nook-vault-sentinel \\")
            && dockerfile[directory_setup..dependency_symlinks]
                .contains("/meta-secret/nook/nook-app/nook-web/nook-web-extension \\"),
        "compile-web must create every package directory that receives a dependency symlink"
    );
    assert!(
        directory_setup < dependency_symlinks && dependency_symlinks < source_copy,
        "compile-web must create package directories before linking dependencies and copying source"
    );
    Ok(())
}

#[test]
fn compile_web_flattens_generated_wasm_packages_into_import_destinations() -> anyhow::Result<()> {
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );
    let dockerfile = std::fs::read_to_string(
        repository_root.join("nook-app/nook-platform/docker/rust/compile.Dockerfile"),
    )?;
    let web_stage = dockerfile
        .find("FROM web-base AS compile-web")
        .expect("compile Dockerfile must retain the web stage");
    let web_stage = &dockerfile[web_stage..];

    assert!(
        dockerfile.contains("prod) wasm_opt_flag=\"\"; stamp_mode=\"optimized\" ;;")
            && dockerfile.contains("dev) wasm_opt_flag=\"--no-opt\"; stamp_mode=\"no-opt\" ;;"),
        "compile-wasm-source must map each WASM build mode to its isolation verifier stamp"
    );
    assert!(
        dockerfile.contains(concat!(
            "printf '%s\\n' \"$stamp_mode\" > ",
            "/opt/nook/wasm-handoff/nook-wasm/nook-wasm-build-mode"
        )),
        "compile-wasm-source must include the selected build mode in its handoff"
    );

    assert!(
        web_stage.contains(concat!(
            "cp -a /tmp/nook-wasm-handoff/nook-wasm/. \\\n",
            "      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/"
        )),
        "compile-web must place nook_wasm.js directly in the vault-app nook-wasm import destination"
    );
    assert!(
        web_stage.contains(concat!(
            "cp -a /tmp/nook-wasm-handoff/nook-companion-wasm/. \\\n",
            "      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/"
        )),
        "compile-web must retain the flattened companion WASM handoff"
    );
    assert!(
        web_stage.contains(concat!(
            "test -f ",
            "nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js"
        )),
        "compile-web must require nook_wasm.js at the web import destination"
    );
    assert!(
        !web_stage.contains(
            "-exec cp -a {} nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/"
        ),
        "compile-web must not nest the nook-wasm handoff directory inside its import destination"
    );
    Ok(())
}

#[test]
fn compile_loom_copies_imported_cortex_sources_after_installing_dependencies() -> anyhow::Result<()>
{
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );
    let dockerfile = std::fs::read_to_string(
        repository_root.join("nook-app/nook-platform/docker/rust/compile.Dockerfile"),
    )?;
    let loom_stage = dockerfile
        .find("FROM web-base AS compile-loom")
        .expect("compile Dockerfile must retain the Loom stage");
    let dependency_install = dockerfile[loom_stage..]
        .find("RUN bun install --frozen-lockfile --ignore-scripts")
        .map(|offset| loom_stage + offset)
        .expect("compile-loom must install its locked dependencies");
    let loom_source = dockerfile[loom_stage..]
        .find("COPY agentic-ai/loom/src src")
        .map(|offset| loom_stage + offset)
        .expect("compile-loom must copy Loom source");
    let compilation = dockerfile[loom_stage..]
        .find("node_modules/.bin/tsc --noEmit -p tsconfig.compile.json")
        .map(|offset| loom_stage + offset)
        .expect("compile-loom must type-check Loom");

    for skill in [
        "cortex-article-structure",
        "cortex-consistency",
        "cortex-document-map",
    ] {
        let source_copy = format!(
            "COPY .cortex/teams/ai/dynamic-skills/{skill}/scripts/src \\\n  /meta-secret/nook/.cortex/teams/ai/dynamic-skills/{skill}/scripts/src"
        );
        let source_copy = dockerfile[loom_stage..]
            .find(&source_copy)
            .map(|offset| loom_stage + offset)
            .unwrap_or_else(|| panic!("compile-loom must copy {skill} source"));

        assert!(
            dependency_install < source_copy && source_copy < compilation,
            "compile-loom must copy {skill} after dependency installation and before compilation"
        );
    }
    assert!(
        dependency_install < loom_source && loom_source < compilation,
        "compile-loom must install dependencies before source copies and compile afterward"
    );
    assert!(
        dockerfile[loom_stage..compilation]
            .contains("ln -s agentic-ai/loom/node_modules /meta-secret/nook/node_modules"),
        "compile-loom must expose Loom dependencies to imported Cortex sources"
    );
    Ok(())
}

#[test]
fn compile_rust_source_stages_invalidate_stub_artifacts_after_every_crate_copy()
-> anyhow::Result<()> {
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );
    let dockerfile = std::fs::read_to_string(
        repository_root.join("nook-app/nook-platform/docker/rust/compile.Dockerfile"),
    )?;
    let native_start = dockerfile
        .find("FROM compile-native-dependencies AS compile-native-source")
        .expect("compile Dockerfile must retain the native source stage");
    let wasm_start = dockerfile
        .find("FROM compile-wasm-dependencies AS compile-wasm-source")
        .expect("compile Dockerfile must retain the WASM source stage");
    let web_start = dockerfile
        .find("FROM web-base AS compile-web")
        .expect("compile Dockerfile must retain the web stage");
    let native_stage = &dockerfile[native_start..wasm_start];
    let wasm_stage = &dockerfile[wasm_start..web_start];

    for (stage_name, stage, crate_groups) in [
        (
            "native",
            native_stage,
            &[
                &["nook-app-common"][..],
                &["nook-authenticator-domain", "nook-auth2"],
                &["nook-replication"],
                &["nook-event-log"],
                &["nook-companion-core"],
                &["nook-core"],
            ][..],
        ),
        (
            "WASM",
            wasm_stage,
            &[
                &["nook-app-common"][..],
                &["nook-authenticator-domain", "nook-auth2"],
                &["nook-replication"],
                &["nook-event-log"],
                &["nook-companion-core"],
                &["nook-core"],
                &["nook-companion-wasm"],
                &["nook-wasm"],
            ][..],
        ),
    ] {
        let expected_copy_count = crate_groups
            .iter()
            .map(|crates| crates.len())
            .sum::<usize>();
        let actual_copy_count = stage
            .lines()
            .filter(|line| line.starts_with("COPY nook-app/nook-platform/nook-"))
            .count();
        assert_eq!(
            actual_copy_count, expected_copy_count,
            "{stage_name} stage crate COPY inventory must stay covered by the freshness contract"
        );

        let mut prior_build = 0;
        for crates in crate_groups {
            let last_copy = crates
                .iter()
                .map(|crate_name| {
                    stage[prior_build..]
                        .find(&format!(
                            "COPY nook-app/nook-platform/{crate_name} {crate_name}"
                        ))
                        .map(|offset| prior_build + offset)
                        .unwrap_or_else(|| panic!("{stage_name} stage must copy {crate_name}"))
                })
                .max()
                .expect("each build step must copy at least one crate");
            let build = stage[last_copy..]
                .find("cargo build --locked")
                .map(|offset| last_copy + offset)
                .unwrap_or_else(|| panic!("{stage_name} stage must build after its crate copies"));
            let invalidation = &stage[last_copy..build];

            for crate_name in *crates {
                assert!(
                    invalidation.contains(&format!("{crate_name}/src/lib.rs")),
                    "{stage_name} stage must touch {crate_name}/src/lib.rs after copying real sources and before building"
                );
            }
            prior_build = build + "cargo build --locked".len();
        }
    }
    Ok(())
}
