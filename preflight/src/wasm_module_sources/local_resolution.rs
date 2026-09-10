use super::*;

impl WasmModuleSources<'_> {
    pub(super) fn resolve_module(
        module: &str,
        source_path: &Path,
    ) -> Result<PathBuf, ModuleResolutionFailure> {
        if Path::new(module).is_absolute() {
            return WasmModuleSources::resolve_local_module(Path::new(module));
        }
        if !module.starts_with('.') {
            return WasmModuleSources::configured_alias_path(module, source_path);
        }
        let parent = source_path
            .parent()
            .ok_or(ModuleResolutionFailure::ParentlessSource)?;
        let unresolved = WasmModuleSources::normalize_local_module_path(&parent.join(module));
        let stripped = WasmModuleSources::strip_module_extension(unresolved.clone());
        if WasmModuleSources::is_known_wasm_path(&stripped) {
            return Ok(unresolved);
        }
        WasmModuleSources::resolve_local_module(&unresolved)
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn configured_alias_path(
        module: &str,
        source_path: &Path,
    ) -> Result<PathBuf, ModuleResolutionFailure> {
        for ancestor in source_path.ancestors() {
            if let Ok(path) =
                WasmModuleSources::tsconfig_alias_path(&ancestor.join("tsconfig.json"), module)
            {
                return WasmModuleSources::resolve_local_module(&path);
            }
        }
        for ancestor in source_path.ancestors() {
            let Ok(entries) = fs::read_dir(ancestor) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let config = entry.path().join("tsconfig.json");
                if let Ok(path) = WasmModuleSources::tsconfig_alias_path(&config, module)
                    && let Ok(resolved) = WasmModuleSources::resolve_local_module(&path)
                {
                    return Ok(resolved);
                }
            }
        }
        Err(ModuleResolutionFailure::UnresolvedAlias)
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn tsconfig_alias_path(
        config: &Path,
        module: &str,
    ) -> Result<PathBuf, ModuleResolutionFailure> {
        let source =
            fs::read_to_string(config).map_err(ModuleResolutionFailure::ConfigurationRead)?;
        let value: TypeScriptAliasConfiguration =
            serde_json::from_str(&source).map_err(ModuleResolutionFailure::ConfigurationSyntax)?;
        for (alias, targets) in &value.compiler_options.paths {
            let suffix = if let Some(prefix) = alias.strip_suffix('*') {
                let Some(suffix) = module.strip_prefix(prefix) else {
                    continue;
                };
                suffix
            } else if alias == module {
                ""
            } else {
                continue;
            };
            let Some(target) = targets.first() else {
                continue;
            };
            let target = target.strip_suffix('*').unwrap_or(target);
            let Some(parent) = config.parent() else {
                continue;
            };
            return Ok(WasmModuleSources::normalize_local_module_path(
                &parent.join(format!("{target}{suffix}")),
            ));
        }
        Err(ModuleResolutionFailure::UnresolvedAlias)
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn is_known_wasm_path(path: &Path) -> bool {
        let path = path.to_string_lossy();
        WASM_MODULE_PATHS
            .iter()
            .any(|candidate| path == *candidate || path.ends_with(&format!("/{candidate}")))
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn resolve_local_module(path: &Path) -> Result<PathBuf, ModuleResolutionFailure> {
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
        if path.extension().is_none() {
            for extension in MODULE_EXTENSIONS {
                let candidate = path.with_extension(extension);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
            for extension in MODULE_EXTENSIONS {
                let candidate = path.join(format!("index.{extension}"));
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
        Err(ModuleResolutionFailure::ModuleNotFound)
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn strip_module_extension(mut path: PathBuf) -> PathBuf {
        if path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| MODULE_EXTENSIONS.contains(&extension))
        {
            path.set_extension("");
        }
        path
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn normalize_local_module_path(path: &Path) -> PathBuf {
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                component => normalized.push(component.as_os_str()),
            }
        }
        normalized
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs, io, path::PathBuf, process};

    use super::WasmModuleSources;

    struct RepositoryFixture {
        path: PathBuf,
    }
    impl RepositoryFixture {
        fn temp_root(name: &str) -> Self {
            Self {
                path: env::temp_dir().join(format!("nook-{name}-{}", process::id())),
            }
        }
    }
    impl std::ops::Deref for RepositoryFixture {
        type Target = PathBuf;
        fn deref(&self) -> &PathBuf {
            &self.path
        }
    }
    impl AsRef<std::path::Path> for RepositoryFixture {
        fn as_ref(&self) -> &std::path::Path {
            &self.path
        }
    }

    #[test]
    fn follows_arbitrary_local_reexport_chains() -> Result<(), io::Error> {
        let root = RepositoryFixture::temp_root("wasm-facade");
        fs::create_dir_all(&root)?;
        fs::write(root.join("bridge.ts"), "export * from '$app-wasm';")?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(
            (WasmModuleSources {
                module: "./bridge",
                source_path: &consumer
            })
            .is_wasm_callable_source()
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn follows_import_then_export_facades() -> Result<(), io::Error> {
        let root = RepositoryFixture::temp_root("wasm-import-export-facade");
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.ts"),
            "import { generate_secret_id as secret } from '$app-wasm'; export { secret as generate_secret_id };",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &consumer,
        ));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn follows_commonjs_facade_exports() -> Result<(), io::Error> {
        let root = RepositoryFixture::temp_root("wasm-commonjs-facade");
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.cjs"),
            "module.exports = require('nook-wasm');",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge.cjs",
            "generate_secret_id",
            &consumer,
        ));
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn preserves_provenance_per_exported_symbol() -> Result<(), io::Error> {
        let root = RepositoryFixture::temp_root("wasm-mixed-facade");
        fs::create_dir_all(&root)?;
        fs::write(
            root.join("bridge.ts"),
            "export { generate_secret_id } from '$app-wasm'; export { connect } from 'socket-lib';",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &consumer,
        ));
        assert!(!WasmModuleSources::is_wasm_callable_export(
            "./bridge", "connect", &consumer
        ));
        fs::remove_dir_all(root)?;
        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeScriptAliasConfiguration {
    compiler_options: TypeScriptAliasOptions,
}
#[derive(serde::Deserialize)]
struct TypeScriptAliasOptions {
    paths: std::collections::BTreeMap<String, Vec<String>>,
}

#[derive(Debug)]
pub(super) enum ModuleResolutionFailure {
    ParentlessSource,
    UnresolvedAlias,
    ModuleNotFound,
    ConfigurationRead(std::io::Error),
    ConfigurationSyntax(serde_json::Error),
}
