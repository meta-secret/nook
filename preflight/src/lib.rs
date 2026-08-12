pub mod coverage;
mod dockerfile_cache;
mod javascript_literals;
mod javascript_scopes;
mod rust_macros;
mod rust_tsify_state;
mod rust_typed_json;
mod rust_wasm_attributes;
mod rust_wasm_names;
pub mod source_size;
mod typescript_discriminants;
mod typescript_domain_boundary;
mod typescript_state;
mod wasm_direct_aliases;
mod wasm_dynamic_aliases;
mod wasm_factories;
mod wasm_inventory;
mod wasm_local_reexports;
mod wasm_member_aliases;
mod wasm_module_sources;
mod wasm_svelte_sources;
mod wasm_web_sources;

pub use dockerfile_cache::dockerfile_cache_mounts;
use dockerfile_cache::is_generated_directory;
pub use typescript_domain_boundary::*;

pub use rust_macros::authored_rust_macro_definitions;
pub use rust_tsify_state::rust_tsify_implicit_absence_overrides;
pub use rust_typed_json::rust_test_untyped_json_assertions;
pub use rust_wasm_names::rust_wasm_callable_name_overrides;
pub use typescript_state::{
    typescript_generic_optional_state, typescript_implicit_application_state,
    typescript_mutable_void_state, typescript_null_absence_sentinels,
    typescript_raw_string_discriminants,
};

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use syn::spanned::Spanned;
use syn::visit::Visit;

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
    "type StartSentinelGenesisArgs = {",
    "type ExistingVaultRecoverySummary = {",
    "type NookPendingSyncConflict = {",
    "type PendingSyncConflictCommonDraft = {",
    "type PendingSyncConflictDraft =",
    "type ProviderStoreMismatch = {",
    "type NookSecretFormFields = {",
    "type PasswordGenerationOptions = {",
    "interface PasswordGenerationOptions {",
];

const TYPESCRIPT_DOMAIN_ALIAS_NAMES: &[&str] = &[
    "AppKind",
    "AuthenticationOutcomeVerdict",
    "AuthenticationOutcomeVerdictName",
    "DeviceMode",
    "DeviceProtectionStatus",
    "ExtensionDeviceMode",
    "ExtensionDeviceProtectionStatus",
    "PopupProtectionStatus",
    "VaultApplication",
    "WasmApplication",
    "VaultType",
    "ReplicationType",
    "OnboardingType",
    "WebsiteLoginSaveDecision",
    "SecretFormInputType",
    "SecretType",
    "StorageProviderType",
    "OAuthFilePreset",
    "GoogleDriveMode",
    "ICloudMode",
    "PasswordGenerationOptions",
    "LastSync",
    "ManualProviderSync",
    "SyncConflictReview",
    "LocalFolderHealth",
    "LocalFolderMultipleVaultsIssue",
];

const TYPESCRIPT_DOMAIN_MIRROR_ENUM_NAMES: &[&str] = &[
    "AppKind",
    "AuthenticationOutcomeVerdict",
    "AuthenticationOutcomeVerdictName",
    "WasmApplication",
    "ExtensionDeviceMode",
    "ExtensionDeviceProtectionStatus",
    "PopupProtectionStatus",
    "VaultApplication",
    "VaultItemType",
    "DeviceMode",
    "DeviceProtectionStatus",
    "VaultType",
    "ReplicationType",
    "OnboardingType",
    "WebsiteLoginSaveDecision",
    "SecretFormInputType",
    "LastSyncKind",
    "ManualProviderSyncKind",
    "SyncConflictReviewKind",
    "LocalFolderHealthKind",
    "SecretType",
    "ExistingVaultProviderSnapshotKind",
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

/// Finds browser-only Rust dependencies used by portable Rust crates.
///
/// # Errors
///
/// Returns an error when a portable Rust source tree cannot be read.
pub fn portable_core_browser_dependencies(root: &Path) -> io::Result<Vec<Violation>> {
    let mut violations = violations_in_tree(
        root,
        Path::new("nook-app/nook-platform/nook-app-common/src"),
        "rs",
        BROWSER_RUST_MARKERS,
    )?;
    violations.extend(violations_in_tree(
        root,
        Path::new("nook-app/nook-platform/nook-core/src"),
        "rs",
        BROWSER_RUST_MARKERS,
    )?);
    violations.extend(violations_in_tree(
        root,
        Path::new("nook-app/nook-platform/nook-replication/src"),
        "rs",
        BROWSER_RUST_MARKERS,
    )?);
    violations.extend(violations_in_tree(
        root,
        Path::new("nook-app/nook-platform/nook-event-log/src"),
        "rs",
        BROWSER_RUST_MARKERS,
    )?);
    Ok(violations)
}

/// Finds authored `JsValue` paths in the WASM bridge.
///
/// # Errors
///
/// Returns an error when a source file cannot be read or parsed as Rust.
pub fn wasm_js_values(root: &Path) -> io::Result<Vec<Violation>> {
    let directory = root.join("nook-app/nook-platform/nook-wasm/src");
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEMPORARY_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
export enum AppKind {
  Simple = 'simple',
}
enum DeviceProtectionStatus {
  Missing = 'missing',
}

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
            vec![7, 8, 9, 11, 14, 18, 24]
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
    fn reports_sentinel_command_and_recovery_summary_mirrors() {
        let source = r"
export type StartSentinelGenesisArgs = {
  label: string
}
export type ExistingVaultRecoverySummary = {
  storeId: string
}
";

        assert_eq!(typescript_boundary_violation_lines(source), vec![2, 5]);
    }

    #[test]
    fn reports_password_generation_option_mirrors() {
        let source = r"
export type PasswordGenerationOptions = {
  length: number
}
interface PasswordGenerationOptions {
  symbols: boolean
}
type PasswordGenerationOptions = Readonly<{ numbers: boolean }>
interface PasswordGenerationOptions
{
  uppercase: boolean
}
type PasswordGenerationOptions =
{
  lowercase: boolean
}
";

        assert_eq!(
            typescript_boundary_violation_lines(source),
            vec![2, 5, 8, 9, 13]
        );
    }

    #[test]
    fn permits_browser_lifecycle_enums_but_reports_provider_mirror() {
        let source = r#"
export enum PendingVaultCreationKind {
  Simple = "simple",
}
enum VaultCreationQueueKind {
  Idle = "idle",
}
export enum ExistingVaultProviderSnapshotKind {
  Local = "local",
}
enum ExistingVaultImportQueueKind {
  Idle = "idle",
}
export enum EnrollmentSubmitQueueKind {
  Idle = "idle",
}
"#;

        assert_eq!(typescript_boundary_violation_lines(source), vec![8]);
    }

    #[test]
    fn reports_json_round_trip_clones_even_when_split_across_lines() {
        let source = r"
const provider = JSON.parse(JSON.stringify(value))
const snapshot = JSON.parse(
  JSON.stringify(state.providers),
)
";

        assert_eq!(json_round_trip_clone_lines(source), vec![2, 3]);
    }

    #[test]
    fn reports_redundant_optional_rune_state_across_lines() {
        let source = r"
let selected = $state<Item | undefined>(undefined)
let recovery = $state<
  RecoverySummary | undefined
>(undefined)
let raw = $state.raw<Config | undefined>(undefined)
let concise = $state<Item>()
";

        assert_eq!(redundant_optional_state_lines(source), vec![2, 3, 6]);
    }

    #[test]
    fn permits_visual_state_but_reports_domain_string_unions() {
        let source = r#"
settingsSection = $state<"storage" | "admin">("storage")
loginUnlockMode = $state<"unknown" | "keys" | "password">("unknown")
remoteRecovery = $state<
  'none' | 'with_cache'
>('none')
"#;

        assert_eq!(domain_string_union_state_lines(source), vec![3, 4]);
    }

    #[test]
    fn reports_domain_identifiers_widened_in_component_state() {
        let source = r"
let switchingTo = $state<string>()
let passwordEntryId = $state<
  string
>()
let providerId = $state<string>()
let selectedStoreId = $state<StoreId>()
";

        assert_eq!(widened_domain_identifier_state_lines(source), vec![2, 3]);
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

    fn write_authored_null_fixture(root: &Path) -> anyhow::Result<()> {
        let web_root = root.join("nook-app/nook-web");
        let app_source = web_root.join("nook-web-app/src");
        let extension_source = web_root.join("nook-web-extension/src/content");
        let select_source = web_root.join("nook-web-shared/src/vault-app/lib/components/ui/select");
        let scripts = web_root.join("nook-web-extension/scripts");
        let github_scripts = root.join(".github/scripts");
        fs::create_dir_all(&app_source)?;
        fs::create_dir_all(&extension_source)?;
        fs::create_dir_all(&select_source)?;
        fs::create_dir_all(&scripts)?;
        fs::create_dir_all(&github_scripts)?;
        fs::write(
            app_source.join("state.ts"),
            "const nullableName = 'annulled'\n// provider returned null\nconst message = \"provider returned null\"\nconst template = `provider returned null`\nconst matcher = /null|nil/\nconst interpolation = `value: ${null}`\nlet value: string | null = null\nconst ratio = amount / null\nconst assertedRatio = value! / (fallback ?? null)\nconst incrementedRatio = index++ / null\n",
        )?;
        fs::write(
            app_source.join("panel.svelte"),
            "<p>null is external</p>\n<!-- {null} is documentation -->\n<Child value={null} />\n{#if true}\n  {@const fallback = null}\n{/if}\n<script lang=\"ts\">\n  const message = 'null'\n  let value = null\n</script>\n",
        )?;
        fs::write(
            extension_source.join("webauthn-page.ts"),
            "getPublicKey: () => null,\nfallback: () => Promise<Credential | null>,\n): Promise<Credential | null> {\nreturn new Promise<Credential | null>((resolve, reject) => {\n",
        )?;
        fs::write(
            extension_source.join("chrome.d.ts"),
            "type External = string | null\n",
        )?;
        fs::write(
            select_source.join("select-trigger.svelte"),
            "ref = $bindable(null),\n",
        )?;
        fs::write(scripts.join("build.ts"), "const value = null\n")?;
        fs::write(
            github_scripts.join("validate.cjs"),
            "const missing = null\n",
        )?;
        Ok(())
    }

    fn expected_authored_null_violations() -> Vec<Violation> {
        vec![
            Violation {
                path: PathBuf::from(".github/scripts/validate.cjs"),
                line: 1,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/panel.svelte"),
                line: 3,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/panel.svelte"),
                line: 5,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/panel.svelte"),
                line: 9,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/state.ts"),
                line: 6,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/state.ts"),
                line: 7,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/state.ts"),
                line: 8,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/state.ts"),
                line: 9,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-app/src/state.ts"),
                line: 10,
            },
            Violation {
                path: PathBuf::from("nook-app/nook-web/nook-web-extension/scripts/build.ts"),
                line: 1,
            },
            Violation {
                path: PathBuf::from(
                    "nook-app/nook-web/nook-web-extension/src/content/webauthn-page.ts",
                ),
                line: 1,
            },
            Violation {
                path: PathBuf::from(
                    "nook-app/nook-web/nook-web-extension/src/content/webauthn-page.ts",
                ),
                line: 2,
            },
            Violation {
                path: PathBuf::from(
                    "nook-app/nook-web/nook-web-extension/src/content/webauthn-page.ts",
                ),
                line: 3,
            },
            Violation {
                path: PathBuf::from(
                    "nook-app/nook-web/nook-web-extension/src/content/webauthn-page.ts",
                ),
                line: 4,
            },
        ]
    }

    #[test]
    fn reports_all_authored_null_while_ignoring_generated_declarations() -> anyhow::Result<()> {
        let root = temporary_directory()?;
        write_authored_null_fixture(&root)?;
        assert_eq!(
            typescript_null_absence_sentinels(&root)?,
            expected_authored_null_violations()
        );
        fs::remove_dir_all(root)?;
        Ok(())
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

    fn temporary_directory() -> anyhow::Result<PathBuf> {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let process_id = std::process::id();
        let sequence = TEMPORARY_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("nook-preflight-{process_id}-{unique}-{sequence}"));
        fs::create_dir(&path)?;
        Ok(path)
    }
}
