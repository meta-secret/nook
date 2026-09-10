pub struct WebSourceInventory<'scan> {
    pub directory: &'scan Path,
    pub files: &'scan mut Vec<PathBuf>,
}
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

impl WebSourceInventory<'_> {
    pub fn collect_web_source_files(self) -> io::Result<()> {
        let Self { directory, files } = self;
        if !directory.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                if !path
                    .file_name()
                    .and_then(OsStr::to_str)
                    .is_some_and(|name| {
                        matches!(
                            name,
                            "build"
                                | "dist"
                                | "node_modules"
                                | "nook-companion-wasm"
                                | "nook-wasm"
                                | "target"
                        )
                    })
                {
                    (WebSourceInventory {
                        directory: &path,
                        files,
                    })
                    .collect_web_source_files()?;
                }
            } else if path
                .extension()
                .and_then(OsStr::to_str)
                .is_some_and(WebSourceInventory::is_supported_web_source_extension)
            {
                files.push(path);
            }
        }
        Ok(())
    }
}

impl WebSourceInventory<'_> {
    pub(super) fn is_supported_web_source_extension(extension: &str) -> bool {
        matches!(
            extension,
            "cjs" | "cts" | "js" | "jsx" | "mjs" | "mts" | "svelte" | "ts" | "tsx"
        )
    }
}
