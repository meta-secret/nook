use super::{Violation, marker_violations};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MOUNT_PREFIX: &str = "--mount=";

/// Finds forbidden `BuildKit` cache mounts in repository Dockerfiles.
///
/// # Errors
///
/// Returns an error when the repository cannot be traversed or contains no
/// Dockerfiles.
pub fn dockerfile_cache_mounts(root: &Path) -> io::Result<Vec<Violation>> {
    let mut dockerfiles = Vec::new();
    collect_dockerfiles(root, &mut dockerfiles)?;

    if dockerfiles.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("no Dockerfiles found below {}", root.display()),
        ));
    }

    marker_violations(root, dockerfiles, contains_cache_mount)
}

fn contains_cache_mount(line: &str) -> bool {
    let mut remaining = line;
    while let Some(prefix_index) = remaining.find(MOUNT_PREFIX) {
        let options = &remaining[prefix_index + MOUNT_PREFIX.len()..];
        let token = options.split_ascii_whitespace().next().unwrap_or_default();
        if token
            .trim_end_matches('\\')
            .split(',')
            .any(|option| option == "type=cache")
        {
            return true;
        }

        remaining = &options[token.len()..];
    }

    false
}

fn collect_dockerfiles(directory: &Path, dockerfiles: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if !is_generated_directory(&path) {
                collect_dockerfiles(&path, dockerfiles)?;
            }
        } else if file_type.is_file() && is_dockerfile(&entry.file_name()) {
            dockerfiles.push(path);
        }
    }

    Ok(())
}

pub(super) fn is_generated_directory(path: &Path) -> bool {
    let name = path.file_name().and_then(|name| name.to_str());
    matches!(name, Some(".git" | "node_modules" | "target" | "dist"))
        || path.ends_with(Path::new("nook-web-shared/src/vault-app/lib/nook-wasm"))
}

fn is_dockerfile(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| name == "Dockerfile" || name.ends_with(".Dockerfile"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMPORARY_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn reports_only_cache_mounts_in_dockerfiles() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        fs::create_dir_all(root.join("nested"))?;
        fs::create_dir_all(root.join("nook-app/nook-platform/docker/rust"))?;
        fs::create_dir_all(
            root.join("nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm"),
        )?;
        fs::write(
            root.join("nested/build.Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/cache true\nRUN --mount=target=/other-cache,type=cache true\n",
        )?;
        fs::write(
            root.join("nook-app/nook-platform/docker/rust/product.Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/wasm-cache true\n",
        )?;
        fs::write(
            root.join("nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/generated-cache true\n",
        )?;
        fs::write(root.join("notes.txt"), "--mount=type=cache")?;

        let violations = dockerfile_cache_mounts(&root)?;

        assert_eq!(
            violations,
            vec![
                Violation {
                    path: PathBuf::from("nested/build.Dockerfile"),
                    line: 2,
                },
                Violation {
                    path: PathBuf::from("nested/build.Dockerfile"),
                    line: 3,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-platform/docker/rust/product.Dockerfile",),
                    line: 2,
                },
            ]
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn fails_when_repository_root_contains_no_dockerfiles() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        let error = dockerfile_cache_mounts(&root)
            .err()
            .ok_or_else(|| anyhow::anyhow!("dockerfile cache test should reject invalid input"))?;
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    fn temporary_directory() -> anyhow::Result<PathBuf> {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let process_id = std::process::id();
        let sequence = TEMPORARY_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "nook-preflight-dockerfile-cache-{process_id}-{unique}-{sequence}"
        ));
        fs::create_dir(&path)?;
        Ok(path)
    }
}
