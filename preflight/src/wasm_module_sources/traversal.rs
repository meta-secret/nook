use super::*;

/// Each recursive branch returns its visited set before the next sibling starts.
#[derive(Default)]
pub(super) struct ModuleTraversal {
    modules: HashSet<PathBuf>,
    symbols: HashSet<(PathBuf, String)>,
}
impl ModuleTraversal {
    pub(super) fn any(mut self, module: &str, source_path: &Path) -> (Self, bool) {
        if WASM_MODULE_ALIASES.contains(&module) {
            return (self, true);
        }
        let Ok(resolved) = WasmModuleSources::resolve_module(module, source_path) else {
            return (self, false);
        };
        if WasmModuleSources::is_known_wasm_path(&WasmModuleSources::strip_module_extension(
            resolved.clone(),
        )) {
            return (self, true);
        }
        if !self.modules.insert(resolved.clone()) {
            return (self, false);
        }
        let Ok(exports) = WasmModuleSources::local_forwarded_exports(&resolved) else {
            return (self, false);
        };
        for export in exports {
            let module = match export {
                ForwardedExport::All { module }
                | ForwardedExport::Named { module, .. }
                | ForwardedExport::Namespace { module, .. } => module,
            };
            let found;
            (self, found) = self.any(&module, &resolved);
            if found {
                return (self, true);
            }
        }
        (self, false)
    }
    pub(super) fn symbol(
        mut self,
        module: &str,
        exported_name: &str,
        source_path: &Path,
    ) -> (Self, bool) {
        if WASM_MODULE_ALIASES.contains(&module) {
            return (self, exported_name != "default");
        }
        let Ok(resolved) = WasmModuleSources::resolve_module(module, source_path) else {
            return (self, false);
        };
        if WasmModuleSources::is_known_wasm_path(&WasmModuleSources::strip_module_extension(
            resolved.clone(),
        )) {
            return (self, exported_name != "default");
        }
        if !self
            .symbols
            .insert((resolved.clone(), exported_name.to_owned()))
        {
            return (self, false);
        }
        let Ok(exports) = WasmModuleSources::local_forwarded_exports(&resolved) else {
            return (self, false);
        };
        let explicit = exports.iter().any(|export| matches!(export, ForwardedExport::Named { exported, .. } if exported == exported_name));
        for export in exports {
            let found;
            match export {
                ForwardedExport::Named {
                    exported,
                    imported,
                    module,
                } if exported == exported_name => {
                    (self, found) = self.symbol(&module, &imported, &resolved)
                }
                ForwardedExport::All { module } if !explicit => {
                    (self, found) = self.symbol(&module, exported_name, &resolved)
                }
                _ => continue,
            }
            if found {
                return (self, true);
            }
        }
        (self, false)
    }
    pub(super) fn callable(
        mut self,
        module: &str,
        exported_name: &str,
        source_path: &Path,
        callable_names: &HashSet<String>,
    ) -> (Self, Result<String, ExportResolutionFailure>) {
        if WASM_MODULE_ALIASES.contains(&module) {
            return (
                self,
                if callable_names.contains(exported_name) {
                    Ok(exported_name.to_owned())
                } else {
                    Err(ExportResolutionFailure::NoMatchingExport)
                },
            );
        }
        let resolved = match WasmModuleSources::resolve_module(module, source_path) {
            Ok(path) => path,
            Err(failure) => return (self, Err(ExportResolutionFailure::Module(failure))),
        };
        if WasmModuleSources::is_known_wasm_path(&WasmModuleSources::strip_module_extension(
            resolved.clone(),
        )) {
            return (
                self,
                if callable_names.contains(exported_name) {
                    Ok(exported_name.to_owned())
                } else {
                    Err(ExportResolutionFailure::NoMatchingExport)
                },
            );
        }
        if !self
            .symbols
            .insert((resolved.clone(), exported_name.to_owned()))
        {
            return (self, Err(ExportResolutionFailure::RepeatedExport));
        }
        let exports = match WasmModuleSources::local_forwarded_exports(&resolved) {
            Ok(exports) => exports,
            Err(failure) => return (self, Err(failure)),
        };
        let explicit = exports.iter().any(|export| matches!(export, ForwardedExport::Named { exported, .. } if exported == exported_name));
        for export in exports {
            let found;
            match export {
                ForwardedExport::Named {
                    exported,
                    imported,
                    module,
                } if exported == exported_name => {
                    (self, found) = self.callable(&module, &imported, &resolved, callable_names)
                }
                ForwardedExport::All { module } if !explicit => {
                    (self, found) = self.callable(&module, exported_name, &resolved, callable_names)
                }
                _ => continue,
            }
            if found.is_ok() {
                return (self, found);
            }
        }
        (self, Err(ExportResolutionFailure::NoMatchingExport))
    }
    pub(super) fn namespace(
        mut self,
        module: &str,
        exported_name: &str,
        source_path: &Path,
    ) -> (Self, Result<String, ExportResolutionFailure>) {
        let resolved = match WasmModuleSources::resolve_module(module, source_path) {
            Ok(path) => path,
            Err(failure) => return (self, Err(ExportResolutionFailure::Module(failure))),
        };
        if !self
            .symbols
            .insert((resolved.clone(), exported_name.to_owned()))
        {
            return (self, Err(ExportResolutionFailure::RepeatedExport));
        }
        let exports = match WasmModuleSources::local_forwarded_exports(&resolved) {
            Ok(exports) => exports,
            Err(failure) => return (self, Err(failure)),
        };
        for export in exports {
            let found;
            match export {
                ForwardedExport::Namespace { exported, module } if exported == exported_name => {
                    found = if Self::default().any(&module, &resolved).1 {
                        Ok({
                            WasmModuleSources::resolve_module(&module, &resolved)
                                .map_or(module, |path| path.to_string_lossy().into_owned())
                        })
                    } else {
                        Err(ExportResolutionFailure::NoMatchingExport)
                    };
                }
                ForwardedExport::Named {
                    exported,
                    imported,
                    module,
                } if exported == exported_name => {
                    (self, found) = self.namespace(&module, &imported, &resolved)
                }
                ForwardedExport::All { module } => {
                    (self, found) = self.namespace(&module, exported_name, &resolved)
                }
                _ => continue,
            }
            if found.is_ok() {
                return (self, found);
            }
        }
        (self, Err(ExportResolutionFailure::NoMatchingExport))
    }
    pub(super) fn factory(
        mut self,
        module: &str,
        exported_name: &str,
        source_path: &Path,
        wasm_type_names: &HashSet<String>,
    ) -> (Self, Result<String, ExportResolutionFailure>) {
        let resolved = match WasmModuleSources::resolve_module(module, source_path) {
            Ok(path) => path,
            Err(failure) => return (self, Err(ExportResolutionFailure::Module(failure))),
        };
        if !self
            .symbols
            .insert((resolved.clone(), exported_name.to_owned()))
        {
            return (self, Err(ExportResolutionFailure::RepeatedExport));
        }
        if let Ok(found) =
            WasmModuleSources::local_factory_return_type(&resolved, exported_name, wasm_type_names)
        {
            return (self, Ok(found));
        }
        let exports = match WasmModuleSources::local_forwarded_exports(&resolved) {
            Ok(exports) => exports,
            Err(failure) => return (self, Err(failure)),
        };
        for export in exports {
            match export {
                ForwardedExport::All { module } => {
                    let found;
                    (self, found) =
                        self.factory(&module, exported_name, &resolved, wasm_type_names);
                    if found.is_ok() {
                        return (self, found);
                    }
                }
                ForwardedExport::Named {
                    exported,
                    imported,
                    module,
                } if exported == exported_name => {
                    return self.factory(&module, &imported, &resolved, wasm_type_names);
                }
                _ => {}
            }
        }
        (self, Err(ExportResolutionFailure::NoMatchingExport))
    }
}
