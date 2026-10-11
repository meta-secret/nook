use anyhow::Context as _;
use nook_preflight::dockerfile_cache::DockerfileRepository;
use std::{collections::BTreeSet, env, fs, path::PathBuf};

#[test]
fn dockerfiles_only_use_the_approved_stateful_policy_cache_mount() -> anyhow::Result<()> {
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );

    let violations = DockerfileRepository::new(&repository_root).dockerfile_cache_mounts()?;
    let policy_path =
        PathBuf::from("nook-app/nook-platform/docker/rust/ecosystem/policy/Dockerfile");
    let (approved, forbidden): (Vec<_>, Vec<_>) = violations
        .into_iter()
        .partition(|violation| violation.path == policy_path);

    assert_eq!(
        approved.len(),
        1,
        "policy checks must use exactly one shared Cargo-home cache mount"
    );
    let policy = fs::read_to_string(repository_root.join(&policy_path))?;
    let approved_line = approved
        .first()
        .and_then(|violation| policy.lines().nth(violation.line.saturating_sub(1)))
        .context("the approved cache mount must have a source line")?;
    let mount = approved_line
        .split_ascii_whitespace()
        .find_map(|token| token.strip_prefix("--mount="))
        .context("the approved cache mount must declare its options")?;
    let options: BTreeSet<_> = mount.split(',').collect();
    assert_eq!(
        options,
        BTreeSet::from([
            "type=cache",
            "id=nook-policy-cargo-home",
            "target=/tmp/nook-policy-cargo",
            "sharing=locked",
        ]),
        "the sole cache mount must remain the locked stateful policy Cargo home"
    );

    assert!(
        forbidden.is_empty(),
        "unapproved Dockerfile cache mounts are prohibited; use ordinary immutable Docker layers instead:\n{}",
        forbidden
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(())
}
