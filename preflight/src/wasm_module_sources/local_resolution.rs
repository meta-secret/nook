use super::inputs::ModuleSource;
use super::projects::{WebSurface, WebWorkspace};
use super::{
    Component, GENERATED_WASM_PATHS, MODULE_EXTENSIONS, OsStr, Path, PathBuf, WASM_FACADE_PATHS,
    WasmModuleSources,
};
use oxc_resolver::{
    ResolveError, ResolveOptions, Resolver, Restriction, TsConfig, TsconfigDiscovery,
    TsconfigOptions, TsconfigReferences,
};
use std::io;
use std::sync::Arc;

pub(super) struct ModuleResolver {
    resolver: Resolver,
    workspace: WebWorkspace,
    surface: WebSurface,
    config: Option<Arc<TsConfig>>,
}

impl WebWorkspace {
    pub(super) fn resolver(&self, surface: WebSurface) -> io::Result<ModuleResolver> {
        let config = surface.paths(&self.web);
        let mut options = ModuleResolver::options();
        let boundary = self.root.clone();
        options
            .restrictions
            .push(Restriction::Fn(Arc::new(move |path| {
                path.starts_with(&boundary)
            })));
        if let Some(config) = &config {
            options.tsconfig = Some(TsconfigDiscovery::Manual(TsconfigOptions {
                config_file: config.clone(),
                references: TsconfigReferences::Disabled,
            }));
        }
        let resolver = Resolver::new(options);
        let config = config
            .map(|path| {
                resolver
                    .resolve_tsconfig(&path)
                    .map_err(|error| io::Error::other(format!("{}: {error}", path.display())))
            })
            .transpose()?;
        Ok(ModuleResolver {
            resolver,
            workspace: self.clone(),
            surface,
            config,
        })
    }
}

impl ModuleResolver {
    fn generated_binding(&self, module: &str) -> Option<PathBuf> {
        let extension = self.surface.generated_entry(module)?;
        // Standalone fixtures may explicitly point a conventional binding name
        // at an authored module. Keep that project's declared ownership.
        if matches!(self.surface, WebSurface::Standalone(Some(_)))
            && self
                .config
                .as_ref()
                .is_some_and(|c| !c.resolve_path_alias_or_base_url(module).is_empty())
        {
            return None;
        }
        Some(
            self.workspace
                .web
                .join(super::VAULT_WASM_PATH)
                .with_extension(extension),
        )
    }

    fn options() -> ResolveOptions {
        ResolveOptions {
            extensions: MODULE_EXTENSIONS
                .iter()
                .map(|ext| format!(".{ext}"))
                .collect(),
            extension_alias: [
                ("js", &["ts", "tsx", "js"][..]),
                ("jsx", &["tsx", "jsx"]),
                ("mjs", &["mts", "mjs"]),
                ("cjs", &["cts", "cjs"]),
            ]
            .into_iter()
            .map(|(ext, targets)| {
                (
                    ext.to_owned(),
                    targets.iter().map(|ext| format!(".{ext}")).collect(),
                )
            })
            .collect(),
            // Third-party package code isn't authored WASM policy input.
            modules: Vec::new(),
            main_fields: Vec::new(),
            ..ResolveOptions::default()
        }
    }
}

#[derive(Debug)]
#[expect(dead_code, reason = "retain the library's resolution diagnostic")]
pub(crate) enum ModuleResolutionFailure {
    ParentlessSource,
    OutsideRepository,
    Resolve(ResolveError),
}

impl ModuleSource<'_> {
    pub(super) fn resolve(&self, module: &str) -> Result<PathBuf, ModuleResolutionFailure> {
        let resolver = &self.inputs.resolver;
        let parent = self
            .parent()
            .ok_or(ModuleResolutionFailure::ParentlessSource)?;
        // Generated WASM glue is deliberately absent in a sealed source checkout.
        // Its known Rust-owned identity remains valid before the artifact is built.
        if let Some(binding) = resolver.generated_binding(module) {
            return Ok(binding);
        }
        if module.starts_with('.') || Path::new(module).is_absolute() {
            let target = WasmModuleSources::normalize_local_module_path(&parent.join(module));
            if target.starts_with(&resolver.workspace.root)
                && GENERATED_WASM_PATHS.iter().any(|name| {
                    WasmModuleSources::strip_module_extension(target.clone()).ends_with(name)
                })
            {
                return Ok(target);
            }
        }
        let target = resolver
            .resolver
            .resolve(parent, module)
            .map_err(ModuleResolutionFailure::Resolve)?
            .into_path_buf();
        if target.starts_with(&resolver.workspace.root) {
            Ok(target)
        } else {
            Err(ModuleResolutionFailure::OutsideRepository)
        }
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn is_known_wasm_path(path: &Path) -> bool {
        GENERATED_WASM_PATHS
            .iter()
            .chain(WASM_FACADE_PATHS)
            .any(|name| path.ends_with(name))
    }
}

impl WasmModuleSources<'_> {
    pub(super) fn strip_module_extension(mut path: PathBuf) -> PathBuf {
        if let Some(name) = path
            .file_name()
            .and_then(OsStr::to_str)
            .and_then(|name| name.strip_suffix(".d.ts"))
        {
            return path.with_file_name(name);
        }
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
    use super::super::inputs::{ModuleInputs, ModuleSource};
    use std::{fs, io};

    use super::WasmModuleSources;

    #[test]
    fn follows_arbitrary_local_reexport_chains() -> Result<(), io::Error> {
        let directory = tempfile::tempdir()?;
        let root = &directory.path().canonicalize()?;
        fs::write(root.join("bridge.ts"), "export * from '$app-wasm';")?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(
            (WasmModuleSources {
                module: "./bridge",
                source_path: &ModuleSource {
                    path: &consumer,
                    inputs: &ModuleInputs::for_directory(root)?
                }
            })
            .is_wasm_callable_source()
        );
        directory.close()?;
        Ok(())
    }

    #[test]
    fn follows_import_then_export_facades() -> Result<(), io::Error> {
        let directory = tempfile::tempdir()?;
        let root = &directory.path().canonicalize()?;
        fs::write(
            root.join("bridge.ts"),
            "import { generate_secret_id as secret } from '$app-wasm'; export { secret as generate_secret_id };",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &ModuleSource {
                path: &consumer,
                inputs: &ModuleInputs::for_directory(root)?
            },
        ));
        directory.close()?;
        Ok(())
    }

    #[test]
    fn follows_commonjs_facade_exports() -> Result<(), io::Error> {
        let directory = tempfile::tempdir()?;
        let root = &directory.path().canonicalize()?;
        fs::write(
            root.join("bridge.cjs"),
            "module.exports = require('nook-wasm');",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge.cjs",
            "generate_secret_id",
            &ModuleSource {
                path: &consumer,
                inputs: &ModuleInputs::for_directory(root)?
            },
        ));
        directory.close()?;
        Ok(())
    }

    #[test]
    fn preserves_provenance_per_exported_symbol() -> Result<(), io::Error> {
        let directory = tempfile::tempdir()?;
        let root = &directory.path().canonicalize()?;
        fs::write(
            root.join("bridge.ts"),
            "export { generate_secret_id } from '$app-wasm'; export { connect } from 'socket-lib';",
        )?;
        let consumer = root.join("consumer.ts");
        fs::write(&consumer, "")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &ModuleSource {
                path: &consumer,
                inputs: &ModuleInputs::for_directory(root)?
            },
        ));
        assert!(!WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "connect",
            &ModuleSource {
                path: &consumer,
                inputs: &ModuleInputs::for_directory(root)?
            }
        ));
        directory.close()?;
        Ok(())
    }
}
