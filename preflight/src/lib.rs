use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MOUNT_PREFIX: &str = "--mount=";

#[derive(Debug, Eq, PartialEq)]
pub struct Violation {
    pub path: PathBuf,
    pub line: usize,
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
