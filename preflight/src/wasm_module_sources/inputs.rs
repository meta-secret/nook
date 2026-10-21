use super::local_resolution::TypeScriptAliasConfiguration;
use super::{ExportResolutionFailure, ForwardedExport, WasmModuleSources};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Successful inputs from one authored-source scan. Query failures still use
/// the ordinary reader; preparing an unused input cannot fail the scan.
#[derive(Default)]
pub(crate) struct ModuleInputs {
    modules: HashMap<PathBuf, Rc<ParsedModule>>,
    configurations: HashMap<PathBuf, Rc<TypeScriptAliasConfiguration>>,
    directories: HashMap<PathBuf, Vec<PathBuf>>,
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
    pub(crate) fn collect(files: &[PathBuf]) -> Self {
        let directories = files
            .iter()
            .flat_map(|path| WasmModuleSources::configuration_ancestors(path))
            .collect::<HashSet<_>>();
        let inputs = files
            .iter()
            .map(PathBuf::as_path)
            .fold(Self::default(), Self::with_module);
        directories.iter().fold(inputs, Self::with_directory)
    }

    #[must_use]
    fn with_module(mut self, path: &Path) -> Self {
        if let Ok(module) = ParsedModule::read(path) {
            self.modules.insert(path.to_path_buf(), Rc::new(module));
        }
        self
    }

    #[must_use]
    fn with_configuration(mut self, path: PathBuf) -> Self {
        if let Ok(configuration) = TypeScriptAliasConfiguration::read(&path) {
            self.configurations.insert(path, Rc::new(configuration));
        }
        self
    }

    #[must_use]
    fn with_directory(self, directory: &PathBuf) -> Self {
        let mut inputs = self.with_configuration(directory.join("tsconfig.json"));
        if let Ok(entries) = fs::read_dir(directory) {
            let paths = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .collect::<Vec<_>>();
            inputs = paths.iter().fold(inputs, |inputs, path| {
                inputs.with_configuration(path.join("tsconfig.json"))
            });
            inputs.directories.insert(directory.clone(), paths);
        }
        inputs
    }

    pub(super) fn module(&self, path: &Path) -> Result<Rc<ParsedModule>, ExportResolutionFailure> {
        match self.modules.get(path) {
            Some(module) => Ok(Rc::clone(module)),
            None => ParsedModule::read(path).map(Rc::new),
        }
    }

    pub(super) fn configuration(
        &self,
        path: &Path,
    ) -> Result<Rc<TypeScriptAliasConfiguration>, super::local_resolution::ModuleResolutionFailure>
    {
        match self.configurations.get(path) {
            Some(configuration) => Ok(Rc::clone(configuration)),
            None => TypeScriptAliasConfiguration::read(path).map(Rc::new),
        }
    }

    pub(super) fn directory(&self, path: &Path) -> Result<Vec<PathBuf>, io::Error> {
        match self.directories.get(path) {
            Some(entries) => Ok(entries.clone()),
            None => fs::read_dir(path).map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .collect()
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ModuleInputs, ModuleSource};
    use crate::wasm_module_sources::WasmModuleSources;
    use crate::wasm_module_sources::local_resolution::ModuleResolutionFailure;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
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
            let root = directory.path().join("nook-web");
            fs::create_dir(&root)?;
            Ok(Self { directory, root })
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
        let inputs = ModuleInputs::collect(&[consumer.clone(), bridge, cycle]);
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
        let first = ModuleInputs::collect(&files);
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
        let second = ModuleInputs::collect(&files);
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
            WasmModuleSources::resolve_module("$bridge", &updated),
            Err(ModuleResolutionFailure::ModuleNotFound)
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
        let inputs = ModuleInputs::collect(&[consumer.clone(), fixture.root.join("absent.ts")]);
        let source = ModuleSource {
            path: &consumer,
            inputs: &inputs,
        };
        assert!(matches!(
            WasmModuleSources::resolve_module("$missing", &source),
            Err(ModuleResolutionFailure::UnresolvedAlias)
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
