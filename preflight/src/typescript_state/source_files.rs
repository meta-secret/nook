use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub(super) fn collect_authored_source_files(
    directory: &Path,
    files: &mut Vec<PathBuf>,
) -> io::Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            if !is_excluded_directory(&path) {
                collect_authored_source_files(&path, files)?;
            }
            continue;
        }
        let is_source = path
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|extension| matches!(extension, "js" | "mjs" | "cjs" | "ts" | "svelte"));
        let is_declaration = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.ends_with(".d.ts"));
        let is_generated_bundle = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
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
    Ok(())
}

fn is_excluded_directory(path: &Path) -> bool {
    // Host-installed by `task impeccable:install`; same exclusion as source_size.
    if path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name == "impeccable")
    }) && path
        .components()
        .any(|component| component.as_os_str() == ".agents")
    {
        return true;
    }
    path.file_name()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|name| {
            matches!(
                name,
                ".git"
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
