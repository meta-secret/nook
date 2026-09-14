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
