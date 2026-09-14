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
