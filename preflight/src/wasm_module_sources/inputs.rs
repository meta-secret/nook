use super::local_resolution::ModuleResolver;
#[cfg(test)]
use super::projects::{WebSurface, WebWorkspace};
use super::{ExportResolutionFailure, ForwardedExport, WasmModuleSources};
use std::collections::HashMap;
use std::fs;
#[cfg(test)]
use std::io;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Parsed authored modules are shared by all application contexts in this scan.
pub(crate) struct ModuleInputs {
    pub(super) modules: Rc<HashMap<PathBuf, Rc<ParsedModule>>>,
    pub(super) resolver: ModuleResolver,
}

pub(crate) struct ModuleSource<'scan> {
    pub(crate) path: &'scan Path,
    pub(crate) inputs: &'scan ModuleInputs,
}

impl Deref for ModuleSource<'_> {
    type Target = Path;

    fn deref(&self) -> &Path {
        self.path
    }
}

pub(super) struct ParsedModule {
    pub(super) source: String,
    pub(super) tree: tree_sitter::Tree,
    pub(super) imports: HashMap<String, (String, String)>,
    pub(super) exports: Vec<ForwardedExport>,
}

impl ParsedModule {
    pub(super) fn read(path: &Path) -> Result<Self, ExportResolutionFailure> {
        let source = fs::read_to_string(path).map_err(ExportResolutionFailure::SourceRead)?;
        let language = match path.extension().and_then(|extension| extension.to_str()) {
            Some("tsx" | "jsx") => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Some(_) | None => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        };
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&language)
            .map_err(ExportResolutionFailure::Language)?;
        let tree = parser
            .parse(&source, None)
            .ok_or(ExportResolutionFailure::ParseUnavailable)?;
        let imports =
            WasmModuleSources::collect_imported_bindings(tree.root_node(), &source, HashMap::new());
        let exports = WasmModuleSources::collect_forwarded_exports(
            tree.root_node(),
            &source,
            &imports,
            Vec::new(),
        );
        Ok(Self {
            source,
            tree,
            imports,
            exports,
        })
    }
}

impl ModuleInputs {
    pub(crate) fn source<'scan>(&'scan self, path: &'scan Path) -> ModuleSource<'scan> {
        ModuleSource { path, inputs: self }
    }
    #[cfg(test)]
    pub(crate) fn for_directory(root: &Path) -> io::Result<Self> {
        Ok(Self {
            modules: Rc::default(),
            resolver: WebWorkspace::at(root)?.resolver(WebSurface::Standalone(None))?,
        })
    }

    pub(super) fn parse(
        files: impl Iterator<Item = PathBuf>,
    ) -> HashMap<PathBuf, Rc<ParsedModule>> {
        files
            .filter_map(|path| {
                ParsedModule::read(&path)
                    .ok()
                    .map(|module| (path, Rc::new(module)))
            })
            .collect()
    }

    pub(super) fn module(&self, path: &Path) -> Result<Rc<ParsedModule>, ExportResolutionFailure> {
        match self.modules.get(path) {
            Some(module) => Ok(Rc::clone(module)),
            None => ParsedModule::read(path).map(Rc::new),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ModuleInputs, ModuleSource, WebSurface, WebWorkspace};
    use crate::wasm_module_sources::WasmModuleSources;
    use crate::wasm_module_sources::local_resolution::ModuleResolutionFailure;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::rc::Rc;
    use tempfile::TempDir;

    struct SourceFixture {
        directory: TempDir,
        root: PathBuf,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AliasConfiguration {
        compiler_options: AliasPaths,
    }

    #[derive(serde::Serialize)]
    struct AliasPaths {
        paths: BTreeMap<String, Vec<String>>,
    }

    impl SourceFixture {
        fn create() -> anyhow::Result<Self> {
            let directory = tempfile::tempdir()?;
            let root = directory.path().canonicalize()?.join("nook-web");
            fs::create_dir(&root)?;
            Ok(Self { directory, root })
        }

        fn inputs(&self, files: &[PathBuf]) -> anyhow::Result<ModuleInputs> {
            let config = self.root.join("tsconfig.json");
            let surface = WebSurface::Standalone(config.is_file().then_some(config));
            Ok(ModuleInputs {
                modules: Rc::new(ModuleInputs::parse(files.iter().cloned())),
                resolver: WebWorkspace::at(self.directory.path())?.resolver(surface)?,
            })
        }

        fn consumer(&self) -> PathBuf {
            self.root.join("consumer.ts")
        }

        fn configuration(&self, target: &str) -> anyhow::Result<()> {
            let configuration = AliasConfiguration {
                compiler_options: AliasPaths {
                    paths: BTreeMap::from([("$bridge".to_owned(), vec![target.to_owned()])]),
                },
            };
            fs::write(
                self.root.join("tsconfig.json"),
                serde_json::to_vec(&configuration)?,
            )?;
            Ok(())
        }
    }

    #[test]
    fn cached_cyclic_exports_keep_each_query_independent() -> anyhow::Result<()> {
        let fixture = SourceFixture::create()?;
        let consumer = fixture.consumer();
        let bridge = fixture.root.join("bridge.ts");
        let cycle = fixture.root.join("cycle.ts");
        fs::write(&consumer, "")?;
        fs::write(
            &bridge,
            "export * from './cycle'; export { generate_secret_id } from '$app-wasm';",
        )?;
        fs::write(
            &cycle,
            "export * from './bridge'; export { connect } from 'socket-lib';",
        )?;
        let inputs = fixture.inputs(&[consumer.clone(), bridge, cycle])?;
        let source = ModuleSource {
            path: &consumer,
            inputs: &inputs,
        };
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &source
        ));
        assert!(!WasmModuleSources::is_wasm_callable_export(
            "./bridge", "connect", &source
        ));
        assert!(WasmModuleSources::is_wasm_callable_export(
            "./cycle",
            "generate_secret_id",
            &source
        ));
        Ok(())
    }

    #[test]
    fn a_new_inventory_observes_replaced_module_and_configuration() -> anyhow::Result<()> {
        let fixture = SourceFixture::create()?;
        let consumer = fixture.consumer();
        let bridge = fixture.root.join("bridge.ts");
        fs::write(&consumer, "")?;
        fs::write(&bridge, "export { generate_secret_id } from '$app-wasm';")?;
        fixture.configuration("./bridge.ts")?;
        let files = vec![consumer.clone(), bridge.clone()];
        let first = fixture.inputs(&files)?;
        let source = ModuleSource {
            path: &consumer,
            inputs: &first,
        };
        assert!(WasmModuleSources::is_wasm_callable_export(
            "$bridge",
            "generate_secret_id",
            &source
        ));
        fs::write(&bridge, "export { generate_secret_id } from 'unrelated';")?;
        fixture.configuration("./missing.ts")?;
        let second = fixture.inputs(&files)?;
        let updated = ModuleSource {
            path: &consumer,
            inputs: &second,
        };
        assert!(!WasmModuleSources::is_wasm_callable_export(
            "./bridge",
            "generate_secret_id",
            &updated
        ));
        assert!(matches!(
            updated.resolve("$bridge"),
            Err(ModuleResolutionFailure::Resolve(_))
        ));
        assert!(WasmModuleSources::is_wasm_callable_export(
            "$bridge",
            "generate_secret_id",
            &source
        ));
        Ok(())
    }

    #[test]
    fn unreadable_preloads_and_unlisted_modules_keep_query_behavior() -> anyhow::Result<()> {
        let fixture = SourceFixture::create()?;
        let consumer = fixture.consumer();
        fs::write(&consumer, "")?;
        fs::write(fixture.root.join("tsconfig.json"), "malformed")?;
        assert!(fixture.inputs(&[]).is_err());
        fs::rename(
            fixture.root.join("tsconfig.json"),
            fixture.root.join("unused.json"),
        )?;
        let inputs = fixture.inputs(&[consumer.clone(), fixture.root.join("absent.ts")])?;
        let source = ModuleSource {
            path: &consumer,
            inputs: &inputs,
        };
        assert!(matches!(
            source.resolve("$missing"),
            Err(ModuleResolutionFailure::Resolve(_))
        ));
        let external = fixture.directory.path().join("external.ts");
        fs::write(&external, "export { generate_secret_id } from '$app-wasm';")?;
        assert!(WasmModuleSources::is_wasm_callable_export(
            "../external",
            "generate_secret_id",
            &source
        ));
        fs::remove_file(&external)?;
        assert!(!WasmModuleSources::is_wasm_callable_export(
            "../external",
            "generate_secret_id",
            &source
        ));
        Ok(())
    }
}
