use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MOUNT_PREFIX: &str = "--mount=";

#[derive(Debug, Eq, PartialEq)]
pub struct Violation {
    pub path: PathBuf,
    pub line: usize,
}

const BROWSER_RUST_MARKERS: &[&str] = &[
    "web_sys::",
    "js_sys::",
    "wasm_bindgen_futures",
    "gloo_",
    "rexie::",
    "idb::",
];

const TYPESCRIPT_DOMAIN_MIRRORS: &[&str] = &[
    "type VaultArchitecture = {",
    "interface VaultArchitecture {",
    "type SentinelPolicy = {",
    "interface SentinelPolicy {",
    "type ProviderReplicationCapability = {",
    "interface ProviderReplicationCapability {",
    "type SentinelGenesisManagerStatus = {",
    "type SentinelGenesisFinalizeResult = {",
    "type NookPendingSyncConflict = {",
    "type NookSecretFormFields = {",
];

pub fn portable_core_browser_dependencies(root: &Path) -> io::Result<Vec<Violation>> {
    violations_in_tree(
        root,
        Path::new("nook-app/nook-core/src"),
        "rs",
        BROWSER_RUST_MARKERS,
    )
}

pub fn typescript_domain_schema_mirrors(root: &Path) -> io::Result<Vec<Violation>> {
    violations_in_tree(
        root,
        Path::new("nook-app/nook-web/nook-web-shared/src/vault-app"),
        "ts",
        TYPESCRIPT_DOMAIN_MIRRORS,
    )
}

fn violations_in_tree(
    root: &Path,
    relative_directory: &Path,
    extension: &str,
    markers: &[&str],
) -> io::Result<Vec<Violation>> {
    let directory = root.join(relative_directory);
    let mut files = Vec::new();
    collect_files_with_extension(&directory, extension, &mut files)?;
    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for (index, line) in contents.lines().enumerate() {
            if markers.iter().any(|marker| line.contains(marker)) {
                violations.push(Violation {
                    path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                    line: index + 1,
                });
            }
        }
    }
    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    Ok(violations)
}

fn collect_files_with_extension(
    directory: &Path,
    extension: &str,
    files: &mut Vec<PathBuf>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if !is_generated_directory(&entry.file_name()) {
                collect_files_with_extension(&path, extension, files)?;
            }
        } else if file_type.is_file()
            && path.extension().and_then(std::ffi::OsStr::to_str) == Some(extension)
        {
            files.push(path);
        }
    }
    Ok(())
}

pub fn dockerfile_cache_mounts(root: &Path) -> io::Result<Vec<Violation>> {
    let mut dockerfiles = Vec::new();
    collect_dockerfiles(root, &mut dockerfiles)?;

    if dockerfiles.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("no Dockerfiles found below {}", root.display()),
        ));
    }

    let mut violations = Vec::new();
    for path in dockerfiles {
        let contents = fs::read_to_string(&path)?;
        for (index, line) in contents.lines().enumerate() {
            if contains_cache_mount(line) {
                violations.push(Violation {
                    path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                    line: index + 1,
                });
            }
        }
    }

    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    Ok(violations)
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
            if !is_generated_directory(&entry.file_name()) {
                collect_dockerfiles(&path, dockerfiles)?;
            }
        } else if file_type.is_file() && is_dockerfile(&entry.file_name()) {
            dockerfiles.push(path);
        }
    }

    Ok(())
}

fn is_generated_directory(name: &std::ffi::OsStr) -> bool {
    matches!(
        name.to_str(),
        Some(".git" | "node_modules" | "target" | "dist")
    )
}

fn is_dockerfile(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| name == "Dockerfile" || name.ends_with(".Dockerfile"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reports_only_cache_mounts_in_dockerfiles() {
        let root = temporary_directory();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(
            root.join("nested/build.Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/cache true\nRUN --mount=target=/other-cache,type=cache true\n",
        )
        .unwrap();
        fs::write(root.join("notes.txt"), "--mount=type=cache").unwrap();

        let violations = dockerfile_cache_mounts(&root).unwrap();

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
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fails_when_repository_root_contains_no_dockerfiles() {
        let root = temporary_directory();
        let error = dockerfile_cache_mounts(&root).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        fs::remove_dir_all(root).unwrap();
    }

    fn temporary_directory() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nook-preflight-{unique}"));
        fs::create_dir(&path).unwrap();
        path
    }
}
