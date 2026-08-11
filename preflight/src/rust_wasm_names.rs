use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use syn::spanned::Spanned;
use syn::{Attribute, ImplItem, Item, Meta, Token, punctuated::Punctuated};

use crate::Violation;
use crate::wasm_direct_aliases::collect_direct_wasm_aliases_and_bindings;
use crate::wasm_dynamic_aliases::collect_dynamic_wasm_aliases_and_bindings;
use crate::wasm_inventory::collect_wasm_inventory;
use crate::wasm_local_reexports::collect_local_wasm_reexport_aliases;
use crate::wasm_svelte_sources::svelte_wasm_import_alias_lines;

/// Finds exported Rust functions and methods renamed at the JavaScript boundary.
///
/// Callers use authored Rust names; property accessor `js_name` remains valid.
///
/// # Errors
///
/// Returns an error when an authored Rust source cannot be read or parsed.
pub fn rust_wasm_callable_name_overrides(root: &Path) -> io::Result<Vec<Violation>> {
    let source_root = root.join("nook-app");
    let mut files = Vec::new();
    collect_rust_files(&source_root, &mut files)?;

    let mut violations = Vec::new();
    let mut callable_names = HashSet::new();
    let mut wasm_type_names = HashSet::new();
    for path in files {
        let source = fs::read_to_string(&path)?;
        let syntax = syn::parse_file(&source).map_err(io::Error::other)?;
        let relative_path = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        collect_item_violations(&syntax.items, &relative_path, &mut violations);
        if relative_path.starts_with("nook-app/nook-platform/nook-wasm/src")
            || relative_path.starts_with("nook-app/nook-platform/nook-companion-wasm/src")
        {
            collect_wasm_inventory(
                &syntax.items,
                false,
                &mut callable_names,
                &mut wasm_type_names,
            );
        }
    }

    let mut web_files = Vec::new();
    collect_web_source_files(&root.join("nook-app/nook-web"), &mut web_files)?;
    for path in web_files {
        let source = fs::read_to_string(&path)?;
        let lines = if path
            .extension()
            .is_some_and(|extension| extension == "svelte")
        {
            svelte_wasm_import_alias_lines(&source, &path, &callable_names, &wasm_type_names)
                .map_err(io::Error::other)?
        } else if path
            .extension()
            .is_some_and(|extension| matches!(extension.to_str(), Some("jsx" | "tsx")))
        {
            tsx_wasm_import_alias_lines(&source, &path, 1, &callable_names, &wasm_type_names)
                .map_err(io::Error::other)?
        } else {
            typescript_wasm_import_alias_lines_at_path(
                &source,
                &path,
                1,
                &callable_names,
                &wasm_type_names,
            )
            .map_err(io::Error::other)?
        };
        let relative_path = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        violations.extend(lines.into_iter().map(|line| Violation {
            path: relative_path.clone(),
            line,
        }));
    }

    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    violations.dedup();
    Ok(violations)
}

pub(super) fn attribute_has_wasm_bindgen(attribute: &Attribute) -> bool {
    meta_contains_wasm_bindgen(&attribute.meta)
}

pub(super) fn attribute_is_wasm_accessor(attribute: &Attribute) -> bool {
    meta_is_wasm_accessor(&attribute.meta)
}

fn meta_is_wasm_accessor(meta: &Meta) -> bool {
    let Meta::List(list) = meta else {
        return false;
    };
    let Ok(options) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated) else {
        return false;
    };
    if meta
        .path()
        .segments
        .last()
        .is_some_and(|segment| segment.ident == "wasm_bindgen")
    {
        return options
            .iter()
            .any(|option| option.path().is_ident("getter") || option.path().is_ident("setter"));
    }
    meta.path().is_ident("cfg_attr") && options.iter().any(meta_is_wasm_accessor)
}

fn meta_contains_wasm_bindgen(meta: &Meta) -> bool {
    if meta
        .path()
        .segments
        .last()
        .is_some_and(|segment| segment.ident == "wasm_bindgen")
    {
        return true;
    }
    if !meta.path().is_ident("cfg_attr") {
        return false;
    }
    let Meta::List(list) = meta else {
        return false;
    };
    let Ok(nested) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated) else {
        return false;
    };
    nested.iter().any(meta_contains_wasm_bindgen)
}

fn collect_web_source_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    if !directory.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            if !path
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
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
                collect_web_source_files(&path, files)?;
            }
        } else if path
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(is_supported_web_source_extension)
        {
            files.push(path);
        }
    }
    Ok(())
}

fn is_supported_web_source_extension(extension: &str) -> bool {
    matches!(
        extension,
        "cjs" | "cts" | "js" | "jsx" | "mjs" | "mts" | "svelte" | "ts" | "tsx"
    )
}

fn collect_rust_files(directory: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    if !directory.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            if !path
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
                .is_some_and(|name| matches!(name, "target" | "node_modules"))
            {
                collect_rust_files(&path, files)?;
            }
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
    Ok(())
}

fn collect_item_violations(items: &[Item], path: &Path, violations: &mut Vec<Violation>) {
    for item in items {
        match item {
            Item::Fn(function) => {
                collect_callable_attributes(&function.attrs, path, violations);
            }
            Item::Impl(implementation) => {
                for item in &implementation.items {
                    if let ImplItem::Fn(function) = item {
                        collect_callable_attributes(&function.attrs, path, violations);
                    }
                }
            }
            Item::Mod(module) => {
                if let Some((_, nested)) = &module.content {
                    collect_item_violations(nested, path, violations);
                }
            }
            _ => {}
        }
    }
}

fn collect_callable_attributes(
    attributes: &[Attribute],
    path: &Path,
    violations: &mut Vec<Violation>,
) {
    for attribute in attributes {
        if wasm_bindgen_callable_has_js_name(attribute) {
            violations.push(Violation {
                path: path.to_path_buf(),
                line: attribute.span().start().line,
            });
        }
    }
}

fn wasm_bindgen_callable_has_js_name(attribute: &Attribute) -> bool {
    meta_has_callable_js_name(&attribute.meta)
}

fn meta_has_callable_js_name(meta: &Meta) -> bool {
    let is_wasm_bindgen_attribute = meta
        .path()
        .segments
        .last()
        .is_some_and(|segment| segment.ident == "wasm_bindgen");
    if is_wasm_bindgen_attribute {
        let Meta::List(list) = meta else {
            return false;
        };
        let Ok(options) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)
        else {
            return false;
        };
        let has_js_name = options
            .iter()
            .any(|option| option.path().is_ident("js_name"));
        let property_accessor = options
            .iter()
            .any(|option| option.path().is_ident("getter") || option.path().is_ident("setter"));
        return has_js_name && !property_accessor;
    }

    if !meta.path().is_ident("cfg_attr") {
        return false;
    }
    let Meta::List(list) = meta else {
        return false;
    };
    let Ok(nested) = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated) else {
        return false;
    };
    nested.iter().any(meta_has_callable_js_name)
}

#[cfg(test)]
fn typescript_wasm_import_alias_lines(
    source: &str,
    first_line: usize,
    callable_names: &HashSet<String>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let wasm_type_names = HashSet::from([
        "NookVaultArchitecture".to_owned(),
        "NookVaultManager".to_owned(),
    ]);
    typescript_wasm_import_alias_lines_at_path(
        source,
        Path::new("nook-app/nook-web/test.ts"),
        first_line,
        callable_names,
        &wasm_type_names,
    )
}

pub(super) fn typescript_wasm_import_alias_lines_at_path(
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    script_wasm_import_alias_lines(
        source,
        source_path,
        first_line,
        callable_names,
        wasm_type_names,
        &tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
    )
}

fn tsx_wasm_import_alias_lines(
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    script_wasm_import_alias_lines(
        source,
        source_path,
        first_line,
        callable_names,
        wasm_type_names,
        &tree_sitter_typescript::LANGUAGE_TSX.into(),
    )
}

fn script_wasm_import_alias_lines(
    source: &str,
    source_path: &Path,
    first_line: usize,
    callable_names: &HashSet<String>,
    wasm_type_names: &HashSet<String>,
    language: &tree_sitter::Language,
) -> Result<Vec<usize>, tree_sitter::LanguageError> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(language)?;
    let Some(tree) = parser.parse(source, None) else {
        return Ok(Vec::new());
    };
    let mut lines = Vec::new();
    let mut imported_callable_bindings = HashSet::new();
    let mut wasm_namespace_bindings = HashSet::new();
    let mut wasm_class_bindings = HashSet::new();
    let mut wasm_instance_bindings = HashSet::new();
    collect_direct_wasm_aliases_and_bindings(
        tree.root_node(),
        source,
        source_path,
        first_line,
        callable_names,
        wasm_type_names,
        &mut wasm_namespace_bindings,
        &mut wasm_class_bindings,
        &mut imported_callable_bindings,
        &mut lines,
    );
    collect_dynamic_wasm_aliases_and_bindings(
        tree.root_node(),
        source,
        source_path,
        first_line,
        callable_names,
        &mut wasm_namespace_bindings,
        &wasm_class_bindings,
        &mut wasm_instance_bindings,
        &mut imported_callable_bindings,
        &mut lines,
    );
    collect_local_wasm_reexport_aliases(
        tree.root_node(),
        source,
        first_line,
        &imported_callable_bindings,
        &mut lines,
    );
    lines.sort_unstable();
    lines.dedup();
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::Path;

    use super::{
        is_supported_web_source_extension, tsx_wasm_import_alias_lines,
        typescript_wasm_import_alias_lines, typescript_wasm_import_alias_lines_at_path,
        wasm_bindgen_callable_has_js_name,
    };

    fn callable_names() -> HashSet<String> {
        [
            "build_enrollment_link",
            "connect",
            "generate_secret_id",
            "is_cloudflare_pr_preview_host",
            "simple",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    }

    fn first_attribute(source: &str) -> Result<syn::Attribute, syn::Error> {
        let function: syn::ItemFn = syn::parse_str(source)?;
        function.attrs.into_iter().next().ok_or_else(|| {
            syn::Error::new(proc_macro2::Span::call_site(), "missing test attribute")
        })
    }

    #[test]
    fn rejects_exported_callable_name_override() -> Result<(), syn::Error> {
        let attribute = first_attribute(
            "#[wasm_bindgen(js_name = classifyExtensionPersistenceDatabases)] pub fn classify_extension_persistence_databases() {}",
        )?;
        assert!(wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn rejects_callable_rename_with_other_value_bearing_options() -> Result<(), syn::Error> {
        let attribute = first_attribute(
            "#[wasm_bindgen(js_name = renamed, unchecked_return_type = \"string\")] pub fn authored() {}",
        )?;
        assert!(wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn rejects_fully_qualified_callable_name_override() -> Result<(), syn::Error> {
        let attribute = first_attribute(
            "#[wasm_bindgen::prelude::wasm_bindgen(js_name = renamed)] pub fn authored() {}",
        )?;
        assert!(wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn rejects_callable_name_override_nested_in_cfg_attr() -> Result<(), syn::Error> {
        let attribute = first_attribute(
            "#[cfg_attr(target_arch = \"wasm32\", wasm_bindgen(js_name = renamed))] pub fn authored() {}",
        )?;
        assert!(wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn permits_property_name_override_nested_in_cfg_attr() -> Result<(), syn::Error> {
        let attribute = first_attribute(
            "#[cfg_attr(target_arch = \"wasm32\", wasm_bindgen(getter, js_name = databaseName))] pub fn database_name() {}",
        )?;
        assert!(!wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn permits_property_name_override() -> Result<(), syn::Error> {
        let attribute = first_attribute(
            "#[wasm_bindgen(getter, js_name = databaseName)] pub fn database_name() {}",
        )?;
        assert!(!wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn permits_direct_export_name() -> Result<(), syn::Error> {
        let attribute = first_attribute("#[wasm_bindgen] pub fn classify_databases() {}")?;
        assert!(!wasm_bindgen_callable_has_js_name(&attribute));
        Ok(())
    }

    #[test]
    fn rejects_typescript_alias_for_generated_wasm_callable()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import {
  build_enrollment_link as buildEnrollmentLinkCore,
} from "$app-wasm";
buildEnrollmentLinkCore();"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_reexport_alias_for_generated_wasm_callable() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"export { is_cloudflare_pr_preview_host as isCloudflarePrPreviewHost } from "$app-wasm";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_for_generated_wasm_callable_through_facade()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import {
  generate_secret_id as generateSecretId,
} from "$lib/nook";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_for_single_word_generated_wasm_callable()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { connect as connectVault } from "$app-wasm";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_with_comment_trivia_before_as() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import {
  generate_secret_id /* preserve local name */ as generateSecretId,
} from "$app-wasm";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_in_local_reexport_of_wasm_callable() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"import { generate_secret_id } from "$app-wasm";
export { generate_secret_id as generateSecretId };"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn permits_alias_when_unrelated_module_contains_wasm_substring()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { connect as openSocket } from "third-party/nook_wasm_adapter";"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn permits_alias_from_unrelated_scoped_package_named_nook_wasm()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { connect as openSocket } from "@vendor/nook-wasm";"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_alias_for_string_literal_wasm_import_name() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"import { "generate_secret_id" as generateSecretId } from "$app-wasm";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_dynamic_wasm_import() -> Result<(), tree_sitter::LanguageError> {
        let source =
            r#"const { generate_secret_id: generateSecretId } = await import("$app-wasm");"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_wasm_namespace_destructuring() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import * as wasm from "$app-wasm";
const { generate_secret_id: generateSecretId } = wasm;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_wasm_namespace_member_assignment()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import * as wasm from "$app-wasm";
const generateSecretId = wasm.generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_copied_from_named_wasm_import() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { generate_secret_id } from "$app-wasm";
const generateSecretId = generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn permits_alias_from_shadowed_wasm_namespace_parameter()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import * as wasm from "$app-wasm";
function inspect(wasm: ThirdPartyClient) {
  const { connect: openSocket } = wasm;
}"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_assignment_alias_copied_from_named_wasm_import()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { generate_secret_id } from "$app-wasm";
let generateSecretId;
generateSecretId = generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![3]
        );
        Ok(())
    }

    #[test]
    fn rejects_assignment_alias_copied_from_wasm_namespace()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import * as wasm from "$app-wasm";
let generateSecretId;
generateSecretId = wasm.generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![3]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_of_generated_static_class_method() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { NookVaultArchitecture } from "$app-wasm";
const simpleVault = NookVaultArchitecture.simple;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_of_generated_instance_method() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { NookVaultManager } from "$app-wasm";
const manager = new NookVaultManager();
const connectVault = manager.connect;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![3]
        );
        Ok(())
    }

    #[test]
    fn permits_loop_scoped_shadow_of_named_wasm_callable() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"import { connect } from "$app-wasm";
for (const connect of clients) {
  const openSocket = connect;
}"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_alias_from_dynamic_import_namespace() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"const wasm = await import("$app-wasm");
const generateSecretId = wasm.generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_function_local_dynamic_import_namespace() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"async function load() {
  const wasm = await import("$app-wasm");
  const generateSecretId = wasm.generate_secret_id;
}"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![3]
        );
        Ok(())
    }

    #[test]
    fn rejects_callable_member_loaded_directly_with_require()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"const generateSecretId = require("nook-wasm").generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_computed_wasm_callable_member_alias() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import * as wasm from "$app-wasm";
const generateSecretId = wasm["generate_secret_id"];"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![2]
        );
        Ok(())
    }

    #[test]
    fn rejects_function_local_generated_instance_method_alias()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { NookVaultManager } from "$app-wasm";
function load() {
  const manager = new NookVaultManager();
  const connectVault = manager.connect;
}"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![4]
        );
        Ok(())
    }

    #[test]
    fn permits_redundant_direct_wasm_alias() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { generate_secret_id as generate_secret_id } from "$app-wasm";"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn permits_redundant_dynamic_wasm_alias() -> Result<(), tree_sitter::LanguageError> {
        let source =
            r#"const { generate_secret_id: generate_secret_id } = await import("$app-wasm");"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_alias_from_escaped_wasm_module_specifier() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"import { generate_secret_id as generateSecretId } from "\u0024app-wasm";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_single_quoted_escaped_wasm_module_specifier()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r"import { generate_secret_id as generateSecretId } from '\u0024app-wasm';";
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_commonjs_wasm_require() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"const { generate_secret_id: generateSecretId } = require("nook-wasm");"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_static_template_wasm_import() -> Result<(), tree_sitter::LanguageError> {
        let source = r"const { generate_secret_id: generateSecretId } = await import(`$app-wasm`);";
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_in_tsx_consumer() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { connect as connectVault } from "$app-wasm";
export const View = () => <div>{connectVault()}</div>;"#;
        assert_eq!(
            tsx_wasm_import_alias_lines(
                source,
                Path::new("nook-app/nook-web/view.tsx"),
                1,
                &callable_names(),
                &HashSet::new(),
            )?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_relative_wasm_facade_import() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { generate_secret_id as generateSecretId } from "../nook";"#;
        assert_eq!(
            typescript_wasm_import_alias_lines_at_path(
                source,
                Path::new("nook-app/nook-web/nook-web-shared/src/vault-app/lib/auth/consumer.ts",),
                1,
                &callable_names(),
                &HashSet::new(),
            )?,
            vec![1]
        );
        Ok(())
    }

    #[test]
    fn supports_standard_javascript_and_typescript_module_extensions() {
        for extension in ["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"] {
            assert!(is_supported_web_source_extension(extension));
        }
    }

    #[test]
    fn permits_alias_for_unrelated_javascript_api() -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { snake_case as snakeCase } from "third-party";"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn permits_generated_wasm_type_alias_and_direct_callable()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import {
  build_enrollment_link,
  type ExtensionConnectScope as RustExtensionConnectScope,
} from "./nook_companion_wasm.js";"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_namespace_introduced_by_later_assignment() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"let wasm;
wasm = await import("$app-wasm");
const generateSecretId = wasm.generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![3]
        );
        Ok(())
    }

    #[test]
    fn rejects_alias_from_factory_and_runtime_accessor_instances()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import { NookVaultManager } from "$app-wasm";
function createManager(): NookVaultManager { throw new Error(); }
const fromFactory = createManager();
const factoryAlias = fromFactory.generate_secret_id;
const vault = (window as { __nookVault: { requireManager(): NookVaultManager } }).__nookVault;
const fromAccessor = vault.requireManager();
const accessorAlias = fromAccessor.generate_secret_id;"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![4, 7]
        );
        Ok(())
    }

    #[test]
    fn permits_runtime_value_shadowing_type_only_wasm_import()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"import type { NookVaultManager } from "$app-wasm";
const NookVaultManager = ThirdPartyManager;
const manager = new NookVaultManager();
const generateSecretId = manager.generate_secret_id;"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn permits_same_named_accessor_on_unrelated_receiver() -> Result<(), tree_sitter::LanguageError>
    {
        let source = r#"const manager = sdk.requireManager();
const openSocket = manager.connect;"#;
        assert!(typescript_wasm_import_alias_lines(source, 1, &callable_names())?.is_empty());
        Ok(())
    }

    #[test]
    fn rejects_destructuring_from_scoped_dynamic_namespace()
    -> Result<(), tree_sitter::LanguageError> {
        let source = r#"function load() {
  const wasm = await import("$app-wasm");
  const { generate_secret_id: generateSecretId } = wasm;
}"#;
        assert_eq!(
            typescript_wasm_import_alias_lines(source, 1, &callable_names())?,
            vec![3]
        );
        Ok(())
    }
}
