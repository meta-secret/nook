use std::path::PathBuf;

#[test]
fn dockerfiles_do_not_use_buildkit_cache_mounts() {
    let repository_root = std::env::var_os("NOOK_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));

    let violations = nook_preflight::dockerfile_cache_mounts(&repository_root)
        .expect("the repository Dockerfiles should be readable");

    assert!(
        violations.is_empty(),
        "Dockerfile cache mounts are prohibited; use ordinary immutable Docker layers instead:\n{}",
        violations
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
}
