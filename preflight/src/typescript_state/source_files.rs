use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const LEGACY_IMPECCABLE_INSTALL: &str = ".agents/skills/impeccable";

pub(super) struct AuthoredSourceFiles<'a> {
    pub(super) directory: &'a Path,
}
impl AuthoredSourceFiles<'_> {
    pub(super) fn collect(self) -> io::Result<Vec<PathBuf>> {
        let directory = self.directory;
        let mut files = Vec::new();
        if !directory.exists() {
            return Ok(files);
        }
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                if !Self::is_excluded_directory(&path) {
                    files.extend(AuthoredSourceFiles { directory: &path }.collect()?);
                }
                continue;
            }
            let is_source = path
                .extension()
                .and_then(OsStr::to_str)
                .is_some_and(|extension| {
                    matches!(extension, "js" | "mjs" | "cjs" | "ts" | "svelte")
                });
            let is_declaration = path
                .file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.ends_with(".d.ts"));
            let is_generated_bundle = path
                .file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.ends_with(".min.js") || name.ends_with(".umd.js"));
            let is_generated_wasm = path.components().any(|component| {
                matches!(
                    component.as_os_str().to_str(),
                    Some("nook-wasm" | "nook-companion-wasm")
                )
            });
            if is_source && !is_declaration && !is_generated_bundle && !is_generated_wasm {
                files.push(path);
            }
        }
        Ok(files)
    }
}

impl AuthoredSourceFiles<'_> {
    fn is_excluded_directory(path: &Path) -> bool {
        if path.ends_with(Path::new(LEGACY_IMPECCABLE_INSTALL)) {
            return true;
        }
        // Meta-Cortex installations and its pinned source checkout are not Nook-authored source.
        path.file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| {
                matches!(
                    name,
                    ".git"
                        | ".meta-cortex"
                        | ".meta-cortex-source"
                        | ".svelte-kit"
                        | "build"
                        | "coverage"
                        | "dist"
                        | "node_modules"
                        | "playwright-report"
                        | "target"
                        | "test-results"
                )
            })
    }
}

#[cfg(test)]
pub mod tests {
    use super::AuthoredSourceFiles;
    use std::fs;
    use std::path::Path;

    #[test]
    fn excludes_only_the_legacy_impeccable_install() {
        assert!(AuthoredSourceFiles::is_excluded_directory(Path::new(
            "/repo/.agents/skills/impeccable"
        )));
        assert!(!AuthoredSourceFiles::is_excluded_directory(Path::new(
            "/repo/.agents/skills/example"
        )));
    }

    #[test]
    fn excludes_installed_meta_cortex_and_keeps_nook_sources_scannable() {
        assert!(AuthoredSourceFiles::is_excluded_directory(Path::new(
            "/repo/.meta-cortex"
        )));
        assert!(!AuthoredSourceFiles::is_excluded_directory(Path::new(
            "/repo/nook-app/nook-web/src"
        )));
    }

    #[test]
    fn collect_excludes_external_meta_cortex_source_and_keeps_nook_sources() -> anyhow::Result<()> {
        let fixture = tempfile::tempdir()?;
        let external_directory = fixture.path().join(".meta-cortex-source");
        fs::create_dir(&external_directory)?;
        let external_source = external_directory.join("articles.ts");
        fs::write(&external_source, "const externalSource = null;\n")?;

        let nook_directory = fixture.path().join("nook-app/nook-web/src");
        fs::create_dir_all(&nook_directory)?;
        let nook_source = nook_directory.join("component.ts");
        fs::write(&nook_source, "const nookSource = undefined;\n")?;

        let files = AuthoredSourceFiles {
            directory: fixture.path(),
        }
        .collect()?;

        assert!(!files.contains(&external_source));
        assert!(files.contains(&nook_source));
        Ok(())
    }
}
