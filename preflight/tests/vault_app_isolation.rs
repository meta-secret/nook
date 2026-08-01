use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(root: &Path, path: &str) -> String {
    fs::read_to_string(root.join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn section<'a>(content: &'a str, start: &str, end: &str) -> &'a str {
    content
        .split_once(start)
        .unwrap_or_else(|| panic!("missing section start: {start}"))
        .1
        .split_once(end)
        .unwrap_or_else(|| panic!("missing section end: {end}"))
        .0
}

#[path = "vault_app_isolation/build_contracts.rs"]
#[allow(clippy::unnecessary_wraps)]
mod build_contracts;
#[path = "vault_app_isolation/hosted_delivery_contracts.rs"]
mod hosted_delivery_contracts;
#[path = "vault_app_isolation/runtime_boundary_contracts.rs"]
mod runtime_boundary_contracts;
