use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use syn::spanned::Spanned;
use syn::visit::Visit;

const MOUNT_PREFIX: &str = "--mount=";

#[derive(Debug, Eq, PartialEq)]
pub struct Violation {
    pub path: PathBuf,
    pub line: usize,
}

const BROWSER_RUST_MARKERS: &[&str] = &[
    "web_sys::",
    "js_sys::",
    "wasm_bindgen_futures",
    "gloo_",
    "rexie::",
    "idb::",
];

const TYPESCRIPT_DOMAIN_MIRRORS: &[&str] = &[
    "type VaultArchitecture = {",
    "interface VaultArchitecture {",
    "type SentinelPolicy = {",
    "interface SentinelPolicy {",
    "type ProviderReplicationCapability = {",
    "interface ProviderReplicationCapability {",
    "type SentinelGenesisManagerStatus = {",
    "type SentinelGenesisFinalizeResult = {",
    "type NookPendingSyncConflict = {",
    "type PendingSyncConflictCommonDraft = {",
    "type PendingSyncConflictDraft =",
    "type ProviderStoreMismatch = {",
    "type NookSecretFormFields = {",
];

const TYPESCRIPT_DOMAIN_ALIAS_NAMES: &[&str] = &[
    "DeviceMode",
    "ExtensionDeviceMode",
    "VaultType",
    "ReplicationType",
    "StorageProviderType",
    "OAuthFilePreset",
    "GoogleDriveMode",
    "ICloudMode",
];

const RUST_WASM_UNCHECKED_TYPE_MARKERS: &[&str] =
    &["unchecked_return_type", "unchecked_param_type"];

const RUST_WASM_TYPED_DOMAIN_FUNCTION_MARKERS: &[&str] = &[
    "auth_provider",
    "sync_provider",
    "provider_snapshot",
    "shared_storage_grant",
    "icloud_shared_storage_target",
];

/// Finds browser-only Rust dependencies used by the portable core crate.
///
/// # Errors
///
/// Returns an error when the core source tree cannot be read.
pub fn portable_core_browser_dependencies(root: &Path) -> io::Result<Vec<Violation>> {
    violations_in_tree(
        root,
        Path::new("nook-app/nook-core/src"),
        "rs",
        BROWSER_RUST_MARKERS,
    )
}

/// Finds TypeScript declarations that duplicate Rust-owned domain boundaries.
///
/// # Errors
///
/// Returns an error when the web source tree cannot be read.
pub fn typescript_domain_boundary_boilerplate(root: &Path) -> io::Result<Vec<Violation>> {
    source_violations(
        root,
        Path::new("nook-app/nook-web"),
        &["ts", "svelte"],
        typescript_boundary_violation_lines,
    )
}

/// Reject declarations that make a raw JavaScript value look typed only in the
/// generated declaration file. Provider/auth DTOs must use an actual Rust ABI
/// type (for example a `Tsify` type), never `JsValue` plus an unchecked hint.
///
/// # Errors
///
/// Returns an error when the WASM source tree cannot be read.
pub fn rust_wasm_domain_boundary_escape_hatches(root: &Path) -> io::Result<Vec<Violation>> {
    source_violations(
        root,
        Path::new("nook-app/nook-wasm/src"),
        &["rs"],
        rust_wasm_boundary_violation_lines,
    )
}

fn source_violations(
    root: &Path,
    relative_directory: &Path,
    extensions: &[&str],
    detector: fn(&str) -> Vec<usize>,
) -> io::Result<Vec<Violation>> {
    let directory = root.join(relative_directory);
    let mut files = Vec::new();
    for extension in extensions {
        collect_files_with_extension(&directory, extension, &mut files)?;
    }

    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for line in detector(&contents) {
            violations.push(Violation {
                path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                line,
            });
        }
    }
    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    violations.dedup();
    Ok(violations)
}

fn rust_wasm_boundary_violation_lines(contents: &str) -> Vec<usize> {
    let lines = contents.lines().collect::<Vec<_>>();
    let mut violations = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        if RUST_WASM_UNCHECKED_TYPE_MARKERS
            .iter()
            .any(|marker| line.contains(marker))
        {
            violations.push(index + 1);
        }
    }

    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim_start();
        let function = trimmed
            .strip_prefix("pub fn ")
            .or_else(|| trimmed.strip_prefix("pub async fn "));
        let Some(function) = function else {
            index += 1;
            continue;
        };
        let function_name = function
            .split(|character: char| character == '(' || character.is_whitespace())
            .next()
            .unwrap_or_default();
        let signature_end = (index..lines.len())
            .find(|line| lines[*line].contains('{') || lines[*line].trim_end().ends_with(';'))
            .unwrap_or(index);
        let signature = lines[index..=signature_end].join(" ");
        if RUST_WASM_TYPED_DOMAIN_FUNCTION_MARKERS
            .iter()
            .any(|marker| function_name.contains(marker))
            && signature.contains("JsValue")
        {
            violations.push(index + 1);
        }
        index = signature_end + 1;
    }

    violations.sort_unstable();
    violations.dedup();
    violations
}

fn typescript_boundary_violation_lines(contents: &str) -> Vec<usize> {
    let lines = contents.lines().collect::<Vec<_>>();
    let wasm_bindings = wasm_import_bindings(contents);
    let mut violations = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        if TYPESCRIPT_DOMAIN_MIRRORS
            .iter()
            .any(|marker| line.contains(marker))
            || is_wasm_type_alias(line, &wasm_bindings)
        {
            violations.push(index + 1);
        }
    }

    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim_start();
        if !trimmed.starts_with("export function ")
            && !trimmed.starts_with("export async function ")
        {
            index += 1;
            continue;
        }

        let function_line = index + 1;
        let Some(body_start) = function_body_start(&lines, index) else {
            index += 1;
            continue;
        };
        let declaration_indent = lines[index].len() - lines[index].trim_start().len();
        let Some(body_end) = (body_start + 1..lines.len()).find(|line| {
            lines[*line].trim() == "}"
                && lines[*line].len() - lines[*line].trim_start().len() == declaration_indent
        }) else {
            index += 1;
            continue;
        };

        let declaration = lines[index..=body_start].join(" ");
        let body = lines[body_start + 1..body_end].join(" ");
        if is_trivial_wasm_forwarder(&declaration, &body, &wasm_bindings) {
            violations.push(function_line);
        }
        index = body_end + 1;
    }

    violations.sort_unstable();
    violations.dedup();
    violations
}

fn is_wasm_type_alias(line: &str, wasm_bindings: &HashSet<String>) -> bool {
    let line = line.trim_start();
    let line = line.strip_prefix("export ").unwrap_or(line);
    let Some(alias) = line.strip_prefix("type ") else {
        return false;
    };
    let Some((name, value)) = alias.split_once('=') else {
        return false;
    };
    if TYPESCRIPT_DOMAIN_ALIAS_NAMES.contains(&name.trim()) {
        return true;
    }
    let value = value.trim_start();
    if value.starts_with("Nook") {
        return true;
    }
    let value = value.trim_end_matches(';').trim();
    is_typescript_identifier(value) && wasm_bindings.contains(value)
}

fn wasm_import_bindings(contents: &str) -> HashSet<String> {
    let mut bindings = HashSet::new();
    let lines = contents.lines().collect::<Vec<_>>();
    let mut index = 0;
    while index < lines.len() {
        if !lines[index].trim_start().starts_with("import ") {
            index += 1;
            continue;
        }

        let start = index;
        while index + 1 < lines.len() && !is_import_statement_complete(&lines, start, index) {
            index += 1;
        }
        let statement = lines[start..=index].join("\n");
        index += 1;

        if !is_wasm_import(&statement) {
            continue;
        }
        let Some(start) = statement.find('{') else {
            continue;
        };
        let Some(end) = statement.rfind('}') else {
            continue;
        };
        for binding in statement[start + 1..end].split(',') {
            let binding = binding.trim();
            if binding.is_empty() {
                continue;
            }
            let binding = binding.strip_prefix("type ").unwrap_or(binding).trim();
            let local_name = binding
                .split_once(" as ")
                .map_or(binding, |(_, local)| local)
                .trim();
            if is_typescript_identifier(local_name) {
                bindings.insert(local_name.to_owned());
            }
        }
    }
    bindings
}

fn is_import_statement_complete(lines: &[&str], start: usize, end: usize) -> bool {
    let statement = lines[start..=end].join("\n");
    if statement.trim_end().ends_with(';') {
        return true;
    }

    let braces = statement
        .chars()
        .fold(0_i32, |depth, character| match character {
            '{' => depth + 1,
            '}' => depth - 1,
            _ => depth,
        });
    braces == 0
        && (statement.contains(" from \"")
            || statement.contains(" from '")
            || statement.trim_start().starts_with("import \"")
            || statement.trim_start().starts_with("import '"))
}

fn is_wasm_import(statement: &str) -> bool {
    statement.contains("from \"$app-wasm\"")
        || statement.contains("from '$app-wasm'")
        || statement.contains("/nook-wasm/nook_wasm\"")
        || statement.contains("/nook-wasm/nook_wasm'")
}

fn function_body_start(lines: &[&str], start: usize) -> Option<usize> {
    let mut parentheses = 0_i32;
    for (index, line) in lines.iter().enumerate().skip(start) {
        for character in line.chars() {
            match character {
                '(' => parentheses += 1,
                ')' => parentheses -= 1,
                _ => {}
            }
        }
        if parentheses == 0 && line.trim_end().ends_with('{') {
            return Some(index);
        }
    }
    None
}

fn is_trivial_wasm_forwarder(
    declaration: &str,
    body: &str,
    wasm_bindings: &HashSet<String>,
) -> bool {
    if declaration.contains('=') {
        return false;
    }

    let statement = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let expression = statement
        .strip_prefix("return await ")
        .or_else(|| statement.strip_prefix("return "))
        .or_else(|| statement.strip_prefix("await "))
        .unwrap_or_default()
        .trim();
    let expression = expression.strip_suffix(';').unwrap_or(expression).trim();
    let Some(open) = expression.find('(') else {
        return false;
    };
    let Some(close) = expression.rfind(')') else {
        return false;
    };
    let callee = expression[..open].trim();
    if !wasm_bindings.contains(callee) {
        return false;
    }
    let trailing = expression[close + 1..].trim();
    if !trailing.is_empty() && !trailing.starts_with("as ") {
        return false;
    }

    let arguments = expression[open + 1..close]
        .split(',')
        .map(str::trim)
        .filter(|argument| !argument.is_empty())
        .collect::<Vec<_>>();
    arguments
        .iter()
        .all(|argument| is_typescript_identifier(argument))
        && forwarded_parameters(declaration).is_some_and(|parameters| parameters == arguments)
}

fn forwarded_parameters(declaration: &str) -> Option<Vec<&str>> {
    let open = declaration.find('(')?;
    let close = declaration.rfind(')')?;
    let parameters = declaration[open + 1..close].trim();
    if parameters.is_empty() {
        return Some(Vec::new());
    }
    if parameters.contains("=>") || parameters.contains(['{', '[', '<']) {
        return None;
    }
    parameters
        .split(',')
        .map(str::trim)
        .filter(|parameter| !parameter.is_empty())
        .map(|parameter| {
            let end = parameter.find([':', '?']).unwrap_or(parameter.len());
            let name = parameter[..end].trim();
            is_typescript_identifier(name).then_some(name)
        })
        .collect()
}

fn is_typescript_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || matches!(first, '_' | '$'))
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '$'))
}

/// Finds authored `JsValue` paths in the WASM bridge.
///
/// # Errors
///
/// Returns an error when a source file cannot be read or parsed as Rust.
pub fn wasm_js_values(root: &Path) -> io::Result<Vec<Violation>> {
    let directory = root.join("nook-app/nook-wasm/src");
    let mut files = Vec::new();
    collect_files_with_extension(&directory, "rs", &mut files)?;
    let mut violations = Vec::new();

    for path in files {
        let contents = fs::read_to_string(&path)?;
        let syntax = syn::parse_file(&contents).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("failed to parse {}: {error}", path.display()),
            )
        })?;
        let mut visitor = JsValueVisitor::default();
        visitor.visit_file(&syntax);
        visitor.lines.sort_unstable();
        visitor.lines.dedup();
        violations.extend(visitor.lines.into_iter().map(|line| Violation {
            path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
            line,
        }));
    }

    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    Ok(violations)
}

#[derive(Default)]
struct JsValueVisitor {
    lines: Vec<usize>,
}

impl<'ast> Visit<'ast> for JsValueVisitor {
    fn visit_path(&mut self, path: &'ast syn::Path) {
        if path
            .segments
            .iter()
            .any(|segment| segment.ident == "JsValue")
        {
            self.lines.push(path.span().start().line);
        }
        syn::visit::visit_path(self, path);
    }

    fn visit_use_tree(&mut self, tree: &'ast syn::UseTree) {
        match tree {
            syn::UseTree::Name(name) if name.ident == "JsValue" => {
                self.lines.push(name.span().start().line);
            }
            syn::UseTree::Rename(rename) if rename.ident == "JsValue" => {
                self.lines.push(rename.span().start().line);
            }
            _ => syn::visit::visit_use_tree(self, tree),
        }
    }
}

fn violations_in_tree(
    root: &Path,
    relative_directory: &Path,
    extension: &str,
    markers: &[&str],
) -> io::Result<Vec<Violation>> {
    let directory = root.join(relative_directory);
    let mut files = Vec::new();
    collect_files_with_extension(&directory, extension, &mut files)?;
    marker_violations(root, files, |line| {
        markers.iter().any(|marker| line.contains(marker))
    })
}

fn marker_violations(
    root: &Path,
    files: Vec<PathBuf>,
    matches: impl Fn(&str) -> bool,
) -> io::Result<Vec<Violation>> {
    let mut violations = Vec::new();
    for path in files {
        let contents = fs::read_to_string(&path)?;
        for (index, line) in contents.lines().enumerate() {
            if matches(line) {
                violations.push(Violation {
                    path: path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                    line: index + 1,
                });
            }
        }
    }
    violations.sort_by(|left, right| left.path.cmp(&right.path).then(left.line.cmp(&right.line)));
    Ok(violations)
}

fn collect_files_with_extension(
    directory: &Path,
    extension: &str,
    files: &mut Vec<PathBuf>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if !is_generated_directory(&path) {
                collect_files_with_extension(&path, extension, files)?;
            }
        } else if file_type.is_file()
            && path.extension().and_then(std::ffi::OsStr::to_str) == Some(extension)
        {
            files.push(path);
        }
    }
    Ok(())
}

/// Finds forbidden `BuildKit` cache mounts in repository Dockerfiles.
///
/// # Errors
///
/// Returns an error when the repository cannot be traversed or contains no
/// Dockerfiles.
pub fn dockerfile_cache_mounts(root: &Path) -> io::Result<Vec<Violation>> {
    let mut dockerfiles = Vec::new();
    collect_dockerfiles(root, &mut dockerfiles)?;

    if dockerfiles.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("no Dockerfiles found below {}", root.display()),
        ));
    }

    marker_violations(root, dockerfiles, contains_cache_mount)
}

fn contains_cache_mount(line: &str) -> bool {
    let mut remaining = line;
    while let Some(prefix_index) = remaining.find(MOUNT_PREFIX) {
        let options = &remaining[prefix_index + MOUNT_PREFIX.len()..];
        let token = options.split_ascii_whitespace().next().unwrap_or_default();
        if token
            .trim_end_matches('\\')
            .split(',')
            .any(|option| option == "type=cache")
        {
            return true;
        }

        remaining = &options[token.len()..];
    }

    false
}

fn collect_dockerfiles(directory: &Path, dockerfiles: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if !is_generated_directory(&path) {
                collect_dockerfiles(&path, dockerfiles)?;
            }
        } else if file_type.is_file() && is_dockerfile(&entry.file_name()) {
            dockerfiles.push(path);
        }
    }

    Ok(())
}

fn is_generated_directory(path: &Path) -> bool {
    let name = path.file_name().and_then(|name| name.to_str());
    matches!(name, Some(".git" | "node_modules" | "target" | "dist"))
        || path.ends_with(Path::new("nook-web-shared/src/vault-app/lib/nook-wasm"))
}

fn is_dockerfile(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| name == "Dockerfile" || name.ends_with(".Dockerfile"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reports_only_cache_mounts_in_dockerfiles() {
        let root = temporary_directory();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::create_dir_all(root.join("nook-app/nook-wasm")).unwrap();
        fs::create_dir_all(
            root.join("nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm"),
        )
        .unwrap();
        fs::write(
            root.join("nested/build.Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/cache true\nRUN --mount=target=/other-cache,type=cache true\n",
        )
        .unwrap();
        fs::write(
            root.join("nook-app/nook-wasm/Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/wasm-cache true\n",
        )
        .unwrap();
        fs::write(
            root.join("nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/Dockerfile"),
            "FROM scratch\nRUN --mount=type=cache,target=/generated-cache true\n",
        )
        .unwrap();
        fs::write(root.join("notes.txt"), "--mount=type=cache").unwrap();

        let violations = dockerfile_cache_mounts(&root).unwrap();

        assert_eq!(
            violations,
            vec![
                Violation {
                    path: PathBuf::from("nested/build.Dockerfile"),
                    line: 2,
                },
                Violation {
                    path: PathBuf::from("nested/build.Dockerfile"),
                    line: 3,
                },
                Violation {
                    path: PathBuf::from("nook-app/nook-wasm/Dockerfile"),
                    line: 2,
                },
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fails_when_repository_root_contains_no_dockerfiles() {
        let root = temporary_directory();
        let error = dockerfile_cache_mounts(&root).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_wasm_type_aliases_and_trivial_forwarders() {
        let source = r#"import {
  deleteAuthProvidersDb as deleteAuthProvidersDbWasm,
  providerReplicationCapability as wasmProviderReplicationCapability,
  VaultAccessStatus,
} from "../nook-wasm/nook_wasm";

export type ProviderReplicationCapability = NookProviderReplicationCapability;
export type VaultSyncAccessStatus = VaultAccessStatus;
export type DeviceMode = 'standard' | 'anti-hacker';
export type { NookVaultMember as VaultMember } from "$app-wasm";

export function providerReplicationCapability(
  provider: StorageProvider,
): NookProviderReplicationCapability {
  return wasmProviderReplicationCapability(provider);
}

export async function deleteAuthProvidersDb(): Promise<void> {
  await deleteAuthProvidersDbWasm();
}

export function adaptedProviderCapability(
  provider: StorageProvider,
): NookProviderReplicationCapability {
  return wasmProviderReplicationCapability(toPlain(provider));
}
"#;

        assert_eq!(
            typescript_boundary_violation_lines(source),
            vec![7, 8, 9, 12, 18]
        );
    }

    #[test]
    fn reports_semicolonless_wasm_imports_and_forwarders() {
        let source = r#"import {
  providerReplicationCapability as wasmProviderReplicationCapability,
  type StorageProvider,
} from "$app-wasm"
import { toPlain } from "./plain"

export type Provider = StorageProvider

export function providerReplicationCapability(
  provider: StorageProvider,
): ProviderReplicationCapability {
  return wasmProviderReplicationCapability(provider)
}

export function adaptedProviderCapability(
  provider: StorageProvider,
): ProviderReplicationCapability {
  return wasmProviderReplicationCapability(toPlain(provider))
}
"#;

        assert_eq!(typescript_boundary_violation_lines(source), vec![7, 9]);
    }

    #[test]
    fn reports_unchecked_wasm_types_and_raw_domain_js_values() {
        let source = r#"
#[wasm_bindgen(
    js_name = loadAuthProviders,
    unchecked_return_type = "AuthProvidersSnapshot"
)]
pub async fn load_auth_providers(
    manager: &NookVaultManager,
) -> Result<JsValue, wasm_bindgen::JsError> {
    load(manager).await
}

#[wasm_bindgen(js_name = buildPasskeyCreationOptions)]
pub fn build_passkey_creation_options() -> Result<JsValue, JsError> {
    browser_options()
}
"#;

        assert_eq!(rust_wasm_boundary_violation_lines(source), vec![4, 6]);
    }

    #[test]
    fn preserves_ui_types_and_wasm_adapters_with_defaults() {
        let source = r#"import {
  buildEnrollmentLink as buildEnrollmentLinkCore,
  providerReplicationCapability as wasmProviderReplicationCapability,
} from "$app-wasm";

export type PanelState = "idle" | "saving";

export function buildEnrollmentLink(
  code: string,
  baseUrl = getEnrollmentLinkBase(),
): string {
  return buildEnrollmentLinkCore(code, baseUrl);
}

export function capabilityLabel(provider: StorageProvider): string {
  const capability = wasmProviderReplicationCapability(provider);
  try {
    return capability.supportsShared ? "shared" : "personal";
  } finally {
    capability.free();
  }
}

export function configuredCapability(): NookProviderReplicationCapability {
  return wasmProviderReplicationCapability(CONFIGURED_PROVIDER);
}
"#;

        assert!(typescript_boundary_violation_lines(source).is_empty());
    }

    #[test]
    fn scans_indented_svelte_script_functions() {
        let source = r#"<script lang="ts">
  import {
    providerSupportsReplication as wasmProviderSupportsReplication,
  } from '$app-wasm';

  export function providerSupportsReplication(
    provider: StorageProvider,
    replicationType: string,
  ): boolean {
    return wasmProviderSupportsReplication(provider, replicationType);
  }
</script>
"#;

        assert_eq!(typescript_boundary_violation_lines(source), vec![6]);
    }

    fn temporary_directory() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nook-preflight-{unique}"));
        fs::create_dir(&path).unwrap();
        path
    }
}
