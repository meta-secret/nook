pub struct SourceRepository<'a> {
    root: &'a Path,
}
impl<'a> SourceRepository<'a> {
    #[must_use]
    pub fn new(root: &'a Path) -> Self {
        Self { root }
    }
}
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::{Attribute, Expr, Item, ItemMacro, ItemMod, Lit, LitStr, Meta, Token};

pub const AUTHORED_SOURCE_LINE_LIMIT: usize = 1_000;

pub const SOURCE_SIZE_REMEDIATION: &str = "P1 hard source-size violation: every authored source file is limited to 1,000 lines and delivery remains blocked until the violation is removed. Review the oversized module and split it along a cohesive domain, capability, ownership, lifecycle, or dependency boundary with narrow interfaces. Extracting tests alone is prohibited. Arbitrary half-splits and numbered part modules are prohibited.";
pub const UNIT_TEST_COLOCATION_REMEDIATION: &str = "P1 Rust test architecture violation: unit tests must be inline with the focused implementation module. Split production by domain or architectural responsibility and colocate each abstraction's tests. Separate crate-level tests are reserved for integration tests.";

const SOURCE_EXTENSIONS: &[&str] = &[
    "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "htm", "html", "java", "js", "jsx", "kt",
    "kts", "mjs", "cjs", "php", "py", "rb", "rs", "scss", "sh", "svelte", "swift", "ts", "tsx",
    "vue", "yaml", "yml",
];

const ALWAYS_EXCLUDED_DIRECTORY_NAMES: &[&str] =
    &[".git", ".svelte-kit", ".wrangler", "node_modules"];
const OUTPUT_DIRECTORY_NAMES: &[&str] = &["coverage", "dist", "target"];

const EXCLUDED_REPOSITORY_PREFIXES: &[&str] = &[
    ".agents/skills/impeccable",
    "workflow/processing",
    "nook-app/nook-web/nook-web-shared/src/generated",
    "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm",
    "nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm",
    "nook-app/nook-platform/nook-app-common/src/generated",
];

#[derive(Debug, Eq, PartialEq)]
pub struct SourceSizeViolation {
    pub path: PathBuf,
    pub lines: usize,
    pub limit: usize,
}

#[derive(Debug, Eq, PartialEq)]
pub struct ExternalUnitTestModuleViolation {
    pub path: PathBuf,
    pub line: usize,
    pub test_module: PathBuf,
}

/// Finds authored source files whose physical line count exceeds the uniform
/// hard limit.
///
/// # Errors
///
/// Returns an error when the repository tree or a candidate source file cannot
/// be read as UTF-8.
impl SourceRepository<'_> {
    /// # Errors
    ///
    /// Returns an error when the repository tree or a candidate source file cannot be read.
    pub fn source_size_violations(&self) -> io::Result<Vec<SourceSizeViolation>> {
        let root = self.root;
        let mut violations = Vec::new();
        SourceRepository::scan_directory(root, root, &mut violations)?;
        violations.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(violations)
    }
}

/// Finds Rust unit-test modules stored in separate files under `src`.
///
/// Crate-level `tests` directories are integration-test boundaries and are not
/// scanned by this rule.
///
/// # Errors
///
/// Returns an error when an authored Rust source or referenced test module
/// cannot be read or parsed.
impl SourceRepository<'_> {
    /// # Errors
    ///
    /// Returns an error when authored Rust or a referenced test module cannot be read or parsed.
    pub fn external_rust_unit_test_modules(
        &self,
    ) -> io::Result<Vec<ExternalUnitTestModuleViolation>> {
        let root = self.root;
        let mut violations = Vec::new();
        SourceRepository::scan_external_unit_tests(root, root, &mut violations)?;
        violations.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.line.cmp(&right.line))
        });
        Ok(violations)
    }
}

impl SourceRepository<'_> {
    fn scan_directory(
        root: &Path,
        directory: &Path,
        violations: &mut Vec<SourceSizeViolation>,
    ) -> io::Result<()> {
        let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(fs::DirEntry::file_name);

        for entry in entries {
            let path = entry.path();
            let relative_path = path.strip_prefix(root).map_err(io::Error::other)?;
            let file_type = entry.file_type()?;

            if file_type.is_dir() {
                if !SourceRepository::is_excluded_directory(relative_path) {
                    SourceRepository::scan_directory(root, &path, violations)?;
                }
                continue;
            }

            if !file_type.is_file() || SourceRepository::is_excluded_path(relative_path) {
                continue;
            }

            let SourceLimit::Governed(limit) = SourceRepository::source_line_limit(relative_path)
            else {
                continue;
            };
            let source = fs::read_to_string(&path)?;
            let lines = source.lines().count();
            if lines > limit {
                violations.push(SourceSizeViolation {
                    path: relative_path.to_path_buf(),
                    lines,
                    limit,
                });
            }
        }
        Ok(())
    }
}

impl SourceRepository<'_> {
    fn scan_external_unit_tests(
        root: &Path,
        directory: &Path,
        violations: &mut Vec<ExternalUnitTestModuleViolation>,
    ) -> io::Result<()> {
        let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(fs::DirEntry::file_name);

        for entry in entries {
            let path = entry.path();
            let relative_path = path.strip_prefix(root).map_err(io::Error::other)?;
            let file_type = entry.file_type()?;

            if file_type.is_dir() {
                if !SourceRepository::is_excluded_directory(relative_path) {
                    SourceRepository::scan_external_unit_tests(root, &path, violations)?;
                }
                continue;
            }
            if !file_type.is_file()
                || SourceRepository::is_excluded_path(relative_path)
                || path.extension().and_then(|value| value.to_str()) != Some("rs")
                || !relative_path
                    .components()
                    .any(|component| component.as_os_str() == "src")
            {
                continue;
            }

            let source = fs::read_to_string(&path)?;
            let syntax = syn::parse_file(&source).map_err(SourceRepository::invalid_rust_source)?;
            SourceRepository::collect_external_unit_test_modules(
                crate::source_size::UnitTestModuleTraversal {
                    root,
                    source_path: relative_path,
                    include_directory: path.parent().unwrap_or_else(|| Path::new("")),
                    module_directory: &SourceRepository::module_directory_for_source(&path),
                    items: &syntax.items,
                    test_context: RustModuleContext::Production,
                    violations,
                },
            )?;
        }
        Ok(())
    }
}

impl SourceRepository<'_> {
    fn collect_external_unit_test_modules(request: UnitTestModuleTraversal<'_>) -> io::Result<()> {
        let UnitTestModuleTraversal {
            root,
            source_path,
            include_directory,
            module_directory,
            items,
            test_context,
            violations,
        } = request;

        for item in items {
            match item {
                Item::Mod(module) => {
                    let module_test_context = if matches!(test_context, RustModuleContext::Test)
                        || SourceRepository::is_cfg_test(&module.attrs)
                    {
                        RustModuleContext::Test
                    } else {
                        RustModuleContext::Production
                    };
                    if let Some((_, nested_items)) = &module.content {
                        SourceRepository::collect_external_unit_test_modules(
                            crate::source_size::UnitTestModuleTraversal {
                                root,
                                source_path,
                                include_directory,
                                module_directory: &module_directory.join(module.ident.to_string()),
                                items: nested_items,
                                test_context: module_test_context,
                                violations,
                            },
                        )?;
                    } else if matches!(module_test_context, RustModuleContext::Test) {
                        SourceRepository::record_external_unit_test_module(
                            root,
                            source_path,
                            module.ident.span().start().line,
                            &SourceRepository::external_module_path(module_directory, module),
                            violations,
                        )?;
                    }
                }
                Item::Macro(item_macro)
                    if (matches!(test_context, RustModuleContext::Test)
                        || SourceRepository::is_cfg_test(&item_macro.attrs))
                        && item_macro.mac.path.is_ident("include") =>
                {
                    if let Ok(path) =
                        SourceRepository::included_source_path(include_directory, item_macro)
                    {
                        SourceRepository::record_external_unit_test_module(
                            root,
                            source_path,
                            item_macro.mac.path.span().start().line,
                            &path,
                            violations,
                        )?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

impl SourceRepository<'_> {
    fn record_external_unit_test_module(
        root: &Path,
        source_path: &Path,
        line: usize,
        test_module: &Path,
        violations: &mut Vec<ExternalUnitTestModuleViolation>,
    ) -> io::Result<()> {
        if test_module.is_file() {
            violations.push(ExternalUnitTestModuleViolation {
                path: source_path.to_path_buf(),
                line,
                test_module: test_module
                    .strip_prefix(root)
                    .map_err(io::Error::other)?
                    .to_path_buf(),
            });
        }
        Ok(())
    }
}

impl SourceRepository<'_> {
    fn included_source_path(
        include_directory: &Path,
        item_macro: &ItemMacro,
    ) -> Result<PathBuf, syn::Error> {
        syn::parse2::<LitStr>(item_macro.mac.tokens.clone())
            .map(|path| include_directory.join(path.value()))
    }
}

impl SourceRepository<'_> {
    fn is_cfg_test(attributes: &[Attribute]) -> bool {
        attributes.iter().any(|attribute| {
            attribute.path().is_ident("cfg")
                && SourceRepository::meta_contains_test(&attribute.meta)
        })
    }
}

impl SourceRepository<'_> {
    fn meta_contains_test(meta: &Meta) -> bool {
        SourceRepository::meta_contains_test_with_polarity(meta, false)
    }
}

impl SourceRepository<'_> {
    fn meta_contains_test_with_polarity(meta: &Meta, negated: bool) -> bool {
        match meta {
            Meta::Path(path) => path.is_ident("test") && !negated,
            Meta::NameValue(_) => false,
            Meta::List(list) => list
                .parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
                .is_ok_and(|nested| {
                    let nested_negated = negated ^ list.path.is_ident("not");
                    nested.iter().any(|meta| {
                        SourceRepository::meta_contains_test_with_polarity(meta, nested_negated)
                    })
                }),
        }
    }
}

impl SourceRepository<'_> {
    fn module_directory_for_source(source_path: &Path) -> PathBuf {
        let parent = source_path.parent().unwrap_or_else(|| Path::new(""));
        match source_path.file_stem().and_then(|stem| stem.to_str()) {
            Some("lib" | "main" | "mod") | None => parent.to_path_buf(),
            Some(stem) => parent.join(stem),
        }
    }
}

impl SourceRepository<'_> {
    fn external_module_path(module_directory: &Path, module: &ItemMod) -> PathBuf {
        if let Some(path) = module.attrs.iter().find_map(|attribute| {
            match SourceRepository::path_attribute(attribute) {
                ModulePathAttribute::Declared(path) => Some(path),
                ModulePathAttribute::Other | ModulePathAttribute::Malformed => None,
            }
        }) {
            return module_directory.join(path);
        }

        let module_name = module.ident.to_string();
        let direct = module_directory.join(format!("{module_name}.rs"));
        if direct.is_file() {
            direct
        } else {
            module_directory.join(module_name).join("mod.rs")
        }
    }
}

impl SourceRepository<'_> {
    fn path_attribute(attribute: &Attribute) -> ModulePathAttribute {
        if !attribute.path().is_ident("path") {
            return ModulePathAttribute::Other;
        }
        let Meta::NameValue(name_value) = &attribute.meta else {
            return ModulePathAttribute::Malformed;
        };
        let Expr::Lit(expression) = &name_value.value else {
            return ModulePathAttribute::Malformed;
        };
        let Lit::Str(path) = &expression.lit else {
            return ModulePathAttribute::Malformed;
        };
        ModulePathAttribute::Declared(path.value())
    }
}

impl SourceRepository<'_> {
    fn invalid_rust_source(error: syn::Error) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidData, error)
    }
}

impl SourceRepository<'_> {
    fn source_line_limit(path: &Path) -> SourceLimit {
        match path.extension().and_then(|extension| extension.to_str()) {
            Some(extension) if SOURCE_EXTENSIONS.contains(&extension) => {
                SourceLimit::Governed(AUTHORED_SOURCE_LINE_LIMIT)
            }
            _ => SourceLimit::Excluded,
        }
    }
}

impl SourceRepository<'_> {
    fn is_excluded_directory(path: &Path) -> bool {
        if SourceRepository::is_excluded_path(path) {
            return true;
        }
        let names = path
            .components()
            .filter_map(|component| {
                let Component::Normal(name) = component else {
                    return None;
                };
                name.to_str()
            })
            .collect::<Vec<_>>();
        let source_index = names.iter().position(|name| *name == "src");
        names.iter().enumerate().any(|(index, name)| {
            ALWAYS_EXCLUDED_DIRECTORY_NAMES.contains(name)
                || (OUTPUT_DIRECTORY_NAMES.contains(name)
                    && source_index.is_none_or(|source_index| index < source_index))
        })
    }
}

impl SourceRepository<'_> {
    fn is_excluded_path(path: &Path) -> bool {
        let normalized = path.to_string_lossy().replace('\\', "/");
        EXCLUDED_REPOSITORY_PREFIXES.iter().any(|prefix| {
            normalized == *prefix
                || normalized
                    .strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AUTHORED_SOURCE_LINE_LIMIT, ExternalUnitTestModuleViolation, SourceRepository,
        SourceSizeViolation,
    };
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::{env, fs, process};

    static TEMPORARY_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn applies_one_hard_limit_to_every_authored_language() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        fs::write(root.join("at-limit.ts"), lines(AUTHORED_SOURCE_LINE_LIMIT))?;
        fs::write(
            root.join("over-limit.ts"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;
        fs::write(
            root.join("over-limit.html"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;
        fs::write(
            root.join("over-limit.yml"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;
        fs::write(root.join("at-limit.rs"), lines(AUTHORED_SOURCE_LINE_LIMIT))?;
        fs::write(
            root.join("over-limit.rs"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;

        assert_eq!(
            SourceRepository::new(&root).source_size_violations()?,
            vec![
                SourceSizeViolation {
                    path: PathBuf::from("over-limit.html"),
                    lines: AUTHORED_SOURCE_LINE_LIMIT + 1,
                    limit: AUTHORED_SOURCE_LINE_LIMIT,
                },
                SourceSizeViolation {
                    path: PathBuf::from("over-limit.rs"),
                    lines: AUTHORED_SOURCE_LINE_LIMIT + 1,
                    limit: AUTHORED_SOURCE_LINE_LIMIT,
                },
                SourceSizeViolation {
                    path: PathBuf::from("over-limit.ts"),
                    lines: AUTHORED_SOURCE_LINE_LIMIT + 1,
                    limit: AUTHORED_SOURCE_LINE_LIMIT,
                },
                SourceSizeViolation {
                    path: PathBuf::from("over-limit.yml"),
                    lines: AUTHORED_SOURCE_LINE_LIMIT + 1,
                    limit: AUTHORED_SOURCE_LINE_LIMIT,
                },
            ]
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn excludes_dependencies_outputs_and_non_source_fixtures() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        for directory in ["node_modules", "target", "coverage", "dist"] {
            fs::create_dir(root.join(directory))?;
            fs::write(
                root.join(directory).join("oversized.ts"),
                lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
            )?;
        }
        fs::create_dir_all(root.join(".agents/skills/impeccable/generated"))?;
        fs::write(
            root.join(".agents/skills/impeccable/generated/oversized.ts"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;
        fs::write(
            root.join("large-fixture.json"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;
        fs::create_dir_all(root.join("src/coverage"))?;
        fs::write(
            root.join("src/coverage/owned.ts"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;

        assert_eq!(
            SourceRepository::new(&root).source_size_violations()?,
            vec![SourceSizeViolation {
                path: PathBuf::from("src/coverage/owned.ts"),
                lines: AUTHORED_SOURCE_LINE_LIMIT + 1,
                limit: AUTHORED_SOURCE_LINE_LIMIT,
            }]
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn excludes_workflow_processing_evidence() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        let processing = root.join("workflow/processing/run/agents/audit/attempt-1");
        fs::create_dir_all(&processing)?;
        fs::write(
            processing.join("generated.ts"),
            lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
        )?;
        fs::write(
            processing.join("generated.rs"),
            "#[cfg(test)]\nmod generated_tests;\n",
        )?;
        fs::write(
            processing.join("generated_tests.rs"),
            "#[test]\nfn generated() {}\n",
        )?;

        assert!(
            SourceRepository::new(&root)
                .source_size_violations()?
                .is_empty()
        );
        assert!(
            SourceRepository::new(&root)
                .external_rust_unit_test_modules()?
                .is_empty()
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn excludes_exact_generated_wasm_roots_but_governs_adjacent_authored_sources()
    -> anyhow::Result<()> {
        let root = temporary_directory()?;
        let generated_roots = [
            "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm",
            "nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm",
        ];
        for generated_root in generated_roots {
            fs::create_dir_all(root.join(generated_root))?;
            fs::write(
                root.join(generated_root).join("generated.js"),
                lines(AUTHORED_SOURCE_LINE_LIMIT + 1),
            )?;
        }
        let authored = [
            "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm-owner.ts",
            "nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm-owner.ts",
        ];
        for path in authored {
            let path = root.join(path);
            fs::create_dir_all(path.parent().ok_or_else(|| {
                anyhow::anyhow!("authored source fixture must have a parent directory")
            })?)?;
            fs::write(path, lines(AUTHORED_SOURCE_LINE_LIMIT + 1))?;
        }

        assert_eq!(
            SourceRepository::new(&root).source_size_violations()?,
            authored
                .into_iter()
                .map(|path| SourceSizeViolation {
                    path: PathBuf::from(path),
                    lines: AUTHORED_SOURCE_LINE_LIMIT + 1,
                    limit: AUTHORED_SOURCE_LINE_LIMIT,
                })
                .collect::<Vec<_>>()
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn rejects_external_unit_tests_but_allows_integration_tests() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        fs::create_dir_all(root.join("crate/src"))?;
        fs::create_dir_all(root.join("crate/src/external"))?;
        fs::create_dir_all(root.join("crate/src/platform"))?;
        fs::create_dir_all(root.join("crate/tests"))?;
        fs::write(
            root.join("crate/src/lib.rs"),
            "mod external;\nmod service;\n#[cfg(test)]\n#[path = \"service_tests.rs\"]\nmod tests;\nmod platform {\n    #[cfg(all(test, target_arch = \"wasm32\"))]\n    mod tests;\n}\n#[cfg(any(feature = \"support\", not(not(test))))]\nmod support;\n#[cfg(not(test))]\nmod production_only;\n#[cfg(test)]\ninclude!(\"included_tests.rs\");\n#[cfg(test)]\nmod inline_included {\n    include!(\"inline_tests.rs\");\n}\n",
        )?;
        fs::write(
            root.join("crate/src/external.rs"),
            "pub fn value() -> usize { 1 }\n#[cfg(test)]\nmod tests;\n",
        )?;
        fs::write(
            root.join("crate/src/external/tests.rs"),
            "pub fn external_unit_fixture() -> usize { 1 }\n",
        )?;
        fs::write(
            root.join("crate/src/service.rs"),
            "pub fn value() -> usize { 1 }\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn inline_unit_behavior() { assert_eq!(super::value(), 1); }\n}\n",
        )?;
        fs::write(
            root.join("crate/src/service_tests.rs"),
            "#[tokio::test]\nasync fn unit_behavior() {}\n",
        )?;
        fs::write(
            root.join("crate/src/platform/tests.rs"),
            "#[test]\nfn platform_behavior() {}\n",
        )?;
        fs::write(
            root.join("crate/src/support.rs"),
            "pub fn support_fixture() {}\n",
        )?;
        fs::write(
            root.join("crate/src/production_only.rs"),
            "pub fn production_behavior() {}\n",
        )?;
        fs::write(
            root.join("crate/src/included_tests.rs"),
            "fn included_unit_behavior() {}\n",
        )?;
        fs::write(
            root.join("crate/src/inline_tests.rs"),
            "fn inline_included_unit_behavior() {}\n",
        )?;
        fs::write(
            root.join("crate/tests/public_contract.rs"),
            "#[test]\nfn integration_behavior() {}\n",
        )?;

        assert_eq!(
            SourceRepository::new(&root).external_rust_unit_test_modules()?,
            vec![
                ExternalUnitTestModuleViolation {
                    path: PathBuf::from("crate/src/external.rs"),
                    line: 3,
                    test_module: PathBuf::from("crate/src/external/tests.rs"),
                },
                ExternalUnitTestModuleViolation {
                    path: PathBuf::from("crate/src/lib.rs"),
                    line: 5,
                    test_module: PathBuf::from("crate/src/service_tests.rs"),
                },
                ExternalUnitTestModuleViolation {
                    path: PathBuf::from("crate/src/lib.rs"),
                    line: 8,
                    test_module: PathBuf::from("crate/src/platform/tests.rs"),
                },
                ExternalUnitTestModuleViolation {
                    path: PathBuf::from("crate/src/lib.rs"),
                    line: 11,
                    test_module: PathBuf::from("crate/src/support.rs"),
                },
                ExternalUnitTestModuleViolation {
                    path: PathBuf::from("crate/src/lib.rs"),
                    line: 15,
                    test_module: PathBuf::from("crate/src/included_tests.rs"),
                },
                ExternalUnitTestModuleViolation {
                    path: PathBuf::from("crate/src/lib.rs"),
                    line: 18,
                    test_module: PathBuf::from("crate/src/inline_tests.rs"),
                },
            ]
        );
        fs::remove_dir_all(root)?;
        Ok(())
    }

    fn lines(count: usize) -> String {
        "line\n".repeat(count)
    }

    fn temporary_directory() -> anyhow::Result<PathBuf> {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let process_id = process::id();
        let sequence = TEMPORARY_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path =
            env::temp_dir().join(format!("nook-source-size-{process_id}-{unique}-{sequence}"));
        fs::create_dir(&path)?;
        Ok(path)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RustModuleContext {
    Production,
    Test,
}

struct UnitTestModuleTraversal<'a> {
    root: &'a Path,
    source_path: &'a Path,
    include_directory: &'a Path,
    module_directory: &'a Path,
    items: &'a [Item],
    test_context: RustModuleContext,
    violations: &'a mut Vec<ExternalUnitTestModuleViolation>,
}

enum SourceLimit {
    Governed(usize),
    Excluded,
}
enum ModulePathAttribute {
    Declared(String),
    Other,
    Malformed,
}
