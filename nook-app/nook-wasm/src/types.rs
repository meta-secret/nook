//! Typed values exported across the wasm-bindgen boundary (no raw `JsValue` bags).

use crate::NookError;
use crate::NookSecretListItem;
use crate::NookSecretRecord;
use crate::NookVaultManager;
use gloo_utils::window;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookLoginAccount {
    secret_id: String,
    username: String,
    website_url: String,
    website_host: String,
}

#[wasm_bindgen]
impl NookLoginAccount {
    pub(crate) fn from_login(id: &nook_core::SecretId, login: &nook_core::LoginSecret) -> Self {
        Self {
            secret_id: id.to_string(),
            username: login.username.clone(),
            website_url: login.website_url.clone(),
            website_host: nook_core::hostname_from_url(&login.website_url),
        }
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        self.username.clone()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        self.website_url.clone()
    }

    #[wasm_bindgen(getter, js_name = websiteHost)]
    pub fn website_host(&self) -> String {
        self.website_host.clone()
    }
}

#[wasm_bindgen]
pub struct NookLoginFillCredential {
    username: String,
    password: String,
}

#[wasm_bindgen]
impl NookLoginFillCredential {
    pub(crate) fn new(username: String, password: String) -> Self {
        Self { username, password }
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        self.username.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn password(&self) -> String {
        self.password.clone()
    }
}

impl Drop for NookLoginFillCredential {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.username.zeroize();
        self.password.zeroize();
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyAccount {
    credential_id: String,
    user_name: String,
    user_display_name: String,
}

#[wasm_bindgen]
impl NookPasskeyAccount {
    pub(crate) fn from_core(value: &nook_core::PasskeySecret) -> Self {
        Self {
            credential_id: value.credential_id.clone(),
            user_name: value.user_name.clone(),
            user_display_name: value.user_display_name.clone(),
        }
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = userName)]
    pub fn user_name(&self) -> String {
        self.user_name.clone()
    }

    #[wasm_bindgen(getter, js_name = userDisplayName)]
    pub fn user_display_name(&self) -> String {
        self.user_display_name.clone()
    }
}

#[wasm_bindgen]
pub struct NookPasskeyRegistration {
    credential_id: String,
    client_data_json: String,
    attestation_object: String,
}

#[wasm_bindgen]
impl NookPasskeyRegistration {
    pub(crate) fn new(
        credential_id: String,
        client_data_json: String,
        attestation_object: String,
    ) -> Self {
        Self {
            credential_id,
            client_data_json,
            attestation_object,
        }
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = clientDataJSON)]
    pub fn client_data_json(&self) -> String {
        self.client_data_json.clone()
    }

    #[wasm_bindgen(getter, js_name = attestationObject)]
    pub fn attestation_object(&self) -> String {
        self.attestation_object.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn transports(&self) -> Vec<String> {
        vec!["internal".to_owned()]
    }
}

#[wasm_bindgen]
pub struct NookPasskeyAssertion {
    credential_id: String,
    client_data_json: String,
    authenticator_data: String,
    signature: String,
    user_handle: String,
}

#[wasm_bindgen]
impl NookPasskeyAssertion {
    pub(crate) fn new(
        credential_id: String,
        client_data_json: String,
        authenticator_data: String,
        signature: String,
        user_handle: String,
    ) -> Self {
        Self {
            credential_id,
            client_data_json,
            authenticator_data,
            signature,
            user_handle,
        }
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = clientDataJSON)]
    pub fn client_data_json(&self) -> String {
        self.client_data_json.clone()
    }

    #[wasm_bindgen(getter, js_name = authenticatorData)]
    pub fn authenticator_data(&self) -> String {
        self.authenticator_data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn signature(&self) -> String {
        self.signature.clone()
    }

    #[wasm_bindgen(getter, js_name = userHandle)]
    pub fn user_handle(&self) -> String {
        self.user_handle.clone()
    }
}

const DEFAULT_VAULT_IDLE_TIMEOUT_MS: u32 = 5 * 60_000;
const DEFAULT_VAULT_IDLE_WARNING_MS: u32 = 30_000;
const MIN_IDLE_TIMEOUT_MS: u32 = 1_000;
const DEFAULT_VAULT_SYNC_INTERVAL_MS: u32 = 60_000;
const MIN_VAULT_SYNC_INTERVAL_MS: u32 = 250;
const RUN_MODE_LOCAL_DEV: &str = "localDev";
const RUN_MODE_LOCAL: &str = "local";
const RUN_MODE_DEVELOPMENT: &str = "development";
const RUN_MODE_TEST: &str = "test";
const RUN_MODE_DEV: &str = "dev";
const RUN_MODE_PROD: &str = "prod";
const RUN_MODE_PRODUCTION: &str = "production";

#[wasm_bindgen(typescript_custom_section)]
const AUTH_PROVIDER_TYPES: &'static str = r#"
export type NookAppLocale = 'en' | 'ru';

export type NookStorageProviderType =
  | 'local'
  | 'local-folder'
  | 'github'
  | 'oauth-file';

export type NookOAuthFilePreset = 'google-drive' | 'icloud';
export type NookGoogleDriveMode = 'private' | 'shared';
export type NookICloudMode = 'private' | 'shared';

export interface NookOAuthFileConfig {
  preset: NookOAuthFilePreset;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  fileId?: string;
  fileName?: string;
  accountEmail?: string;
  driveMode?: NookGoogleDriveMode;
  /** Shared-mode My Drive folder id (`drive.file` + `drive.readonly`). */
  folderId?: string;
  iCloudMode?: NookICloudMode;
  /** Non-secret serialized CloudKit share/zone routing target. */
  iCloudShareTarget?: string;
}

export interface NookLocalFolderProviderConfig {
  directoryName?: string;
  handleId?: string;
}

export interface NookStorageProvider {
  id: string;
  type: NookStorageProviderType;
  label: string;
  githubPat?: string;
  githubRepo?: string;
  oauthFile?: NookOAuthFileConfig;
  localFolder?: NookLocalFolderProviderConfig;
  storeId?: string;
  lastSyncedVersion?: number;
  lastSyncedAt?: string;
  lastSyncRevision?: string;
  lastCommonContentHash?: string;
  createdAt: string;
}

export interface NookAuthProvidersSnapshot {
  providers: NookStorageProvider[];
  activeVaultStoreId?: string;
}

export interface NookLoadedAuthProviders {
  snapshot: NookAuthProvidersSnapshot;
  changed: boolean;
}

export interface NookLocalAuthProviderSnapshot {
  snapshot: NookAuthProvidersSnapshot;
  migrated: boolean;
}
"#;

fn parse_config_millis(raw: Option<String>, min: u32) -> Option<u32> {
    let raw = raw?;
    if raw.is_empty() {
        return None;
    }
    let value = raw.parse::<u32>().ok()?;
    if value >= min { Some(value) } else { None }
}

fn browser_language_tags() -> Vec<String> {
    let navigator = window().navigator();
    let mut tags = navigator
        .languages()
        .iter()
        .filter_map(|value| value.as_string())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if tags.is_empty()
        && let Some(language) = navigator.language()
    {
        let language = language.trim();
        if !language.is_empty() {
            tags.push(language.to_owned());
        }
    }

    tags
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookBrowserLocale {
    language_tags: Vec<String>,
}

#[wasm_bindgen]
impl NookBrowserLocale {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            language_tags: browser_language_tags(),
        }
    }

    #[wasm_bindgen(js_name = fromTags)]
    pub fn from_tags(tags: Vec<String>) -> Self {
        Self {
            language_tags: tags,
        }
    }

    #[wasm_bindgen(js_name = languageTags)]
    #[must_use]
    pub fn language_tags(&self) -> Vec<String> {
        self.language_tags.clone()
    }

    #[wasm_bindgen(js_name = appLocale)]
    #[must_use]
    pub fn app_locale(&self) -> String {
        nook_core::resolve_app_locale_from_tags(self.language_tags.iter().map(String::as_str))
            .to_owned()
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookClientRunMode {
    Local,
    Dev,
    Prod,
}

#[wasm_bindgen]
pub struct NookClientRunModeUtil;

#[wasm_bindgen]
impl NookClientRunModeUtil {
    pub fn parse(mode: &str) -> Result<NookClientRunMode, wasm_bindgen::JsError> {
        match mode {
            RUN_MODE_LOCAL_DEV | RUN_MODE_LOCAL | RUN_MODE_DEVELOPMENT | RUN_MODE_TEST => {
                Ok(NookClientRunMode::Local)
            }
            RUN_MODE_DEV => Ok(NookClientRunMode::Dev),
            RUN_MODE_PROD | RUN_MODE_PRODUCTION => Ok(NookClientRunMode::Prod),
            _ => Err(wasm_bindgen::JsError::new(&format!(
                "Unknown client run mode: {mode}"
            ))),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStorageProviderKind {
    Local,
    LocalFolder,
    Github,
    OauthFile,
}

impl From<nook_core::StorageProviderType> for NookStorageProviderKind {
    fn from(provider_type: nook_core::StorageProviderType) -> Self {
        match provider_type {
            nook_core::StorageProviderType::Local => Self::Local,
            nook_core::StorageProviderType::LocalFolder => Self::LocalFolder,
            nook_core::StorageProviderType::Github => Self::Github,
            nook_core::StorageProviderType::OauthFile => Self::OauthFile,
        }
    }
}

#[wasm_bindgen]
pub struct NookStorageProviderTypeUtil;

#[wasm_bindgen]
impl NookStorageProviderTypeUtil {
    pub fn parse(provider_type: &str) -> Result<NookStorageProviderKind, wasm_bindgen::JsError> {
        Ok(nook_core::StorageProviderType::parse(provider_type)?.into())
    }

    #[wasm_bindgen(js_name = value)]
    #[must_use]
    pub fn value(kind: NookStorageProviderKind) -> String {
        match kind {
            NookStorageProviderKind::Local => nook_core::StorageProviderType::Local,
            NookStorageProviderKind::LocalFolder => nook_core::StorageProviderType::LocalFolder,
            NookStorageProviderKind::Github => nook_core::StorageProviderType::Github,
            NookStorageProviderKind::OauthFile => nook_core::StorageProviderType::OauthFile,
        }
        .as_str()
        .to_owned()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookStorageConnectArgs {
    mode: String,
    pat: String,
    repo: String,
}

impl From<nook_core::StorageConnectArgs> for NookStorageConnectArgs {
    fn from(args: nook_core::StorageConnectArgs) -> Self {
        Self {
            mode: args.mode,
            pat: args.pat,
            repo: args.repo,
        }
    }
}

#[wasm_bindgen]
impl NookStorageConnectArgs {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn mode(&self) -> String {
        self.mode.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookGoogleDriveFolder {
    id: String,
    name: String,
}

impl NookGoogleDriveFolder {
    pub(crate) fn new(id: String, name: String) -> Self {
        Self { id, name }
    }
}

#[wasm_bindgen]
impl NookGoogleDriveFolder {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn name(&self) -> String {
        self.name.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookRuntimeConfig {
    run_mode: NookClientRunMode,
    e2e_expose_vault: bool,
}

#[wasm_bindgen]
impl NookRuntimeConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(run_mode: NookClientRunMode, e2e_expose_vault: bool) -> Self {
        Self {
            run_mode,
            e2e_expose_vault,
        }
    }

    #[wasm_bindgen(getter, js_name = runMode)]
    #[must_use]
    pub fn run_mode(&self) -> NookClientRunMode {
        self.run_mode
    }

    #[wasm_bindgen(getter, js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        self.run_mode == NookClientRunMode::Local
    }

    #[wasm_bindgen(getter, js_name = isDev)]
    #[must_use]
    pub fn is_dev(&self) -> bool {
        self.run_mode == NookClientRunMode::Dev
    }

    #[wasm_bindgen(getter, js_name = isProd)]
    #[must_use]
    pub fn is_prod(&self) -> bool {
        self.run_mode == NookClientRunMode::Prod
    }

    #[wasm_bindgen(getter, js_name = e2eExposeVault)]
    #[must_use]
    pub fn e2e_expose_vault(&self) -> bool {
        self.e2e_expose_vault
    }

    #[must_use]
    pub fn allow_fast_idle(&self) -> bool {
        self.run_mode != NookClientRunMode::Prod || self.e2e_expose_vault
    }

    #[wasm_bindgen(js_name = allowFastSync)]
    #[must_use]
    pub fn allow_fast_sync(&self) -> bool {
        self.run_mode != NookClientRunMode::Prod || self.e2e_expose_vault
    }

    #[wasm_bindgen(js_name = exposeDebugHooks)]
    #[must_use]
    pub fn expose_debug_hooks(&self) -> bool {
        self.run_mode != NookClientRunMode::Prod || self.e2e_expose_vault
    }

    #[wasm_bindgen(js_name = resolveVaultIdleTimeoutMs)]
    #[must_use]
    pub fn resolve_vault_idle_timeout_ms(&self, raw_timeout_ms: Option<String>) -> u32 {
        if !self.allow_fast_idle() {
            return DEFAULT_VAULT_IDLE_TIMEOUT_MS;
        }
        parse_config_millis(raw_timeout_ms, MIN_IDLE_TIMEOUT_MS)
            .unwrap_or(DEFAULT_VAULT_IDLE_TIMEOUT_MS)
    }

    #[wasm_bindgen(js_name = resolveVaultIdleWarningMs)]
    #[must_use]
    pub fn resolve_vault_idle_warning_ms(&self, raw_warning_ms: Option<String>) -> u32 {
        if !self.allow_fast_idle() {
            return DEFAULT_VAULT_IDLE_WARNING_MS;
        }
        parse_config_millis(raw_warning_ms, 0).unwrap_or(DEFAULT_VAULT_IDLE_WARNING_MS)
    }

    #[wasm_bindgen(js_name = resolveVaultSyncIntervalMs)]
    #[must_use]
    pub fn resolve_vault_sync_interval_ms(&self, raw_interval_ms: Option<String>) -> u32 {
        if !self.allow_fast_sync() {
            return DEFAULT_VAULT_SYNC_INTERVAL_MS;
        }
        parse_config_millis(raw_interval_ms, MIN_VAULT_SYNC_INTERVAL_MS)
            .unwrap_or(DEFAULT_VAULT_SYNC_INTERVAL_MS)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeySetup {
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeySetup {
    pub(crate) fn from_core(setup: &nook_core::DeviceKeyProtectionSetup) -> Self {
        Self {
            user_handle: setup.user_handle().to_vec(),
            prf_input: setup.prf_input().to_vec(),
        }
    }
}

#[wasm_bindgen]
impl NookPasskeySetup {
    #[wasm_bindgen(getter, js_name = userHandle)]
    pub fn user_handle(&self) -> Vec<u8> {
        self.user_handle.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen(js_name = creationOptions)]
    pub fn creation_options(
        &self,
        rp_id: &str,
        rp_name: &str,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> {
        crate::passkey_browser::creation_options(
            rp_id,
            rp_name,
            crate::passkey_browser::DEFAULT_PASSKEY_LABEL,
            &self.user_handle,
            &self.prf_input,
        )
    }

    /// Build browser registration options with the label chosen by the caller.
    /// The browser ceremony remains in the presentation layer; this only
    /// prepares the typed `WebAuthn` request from Rust-owned setup material.
    #[wasm_bindgen(js_name = creationOptionsWithLabel)]
    pub fn creation_options_with_label(
        &self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> {
        crate::passkey_browser::creation_options(
            rp_id,
            rp_name,
            passkey_label,
            &self.user_handle,
            &self.prf_input,
        )
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyUnlockOptions {
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeyUnlockOptions {
    pub(crate) fn from_core(
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<Self, nook_core::DeviceKeyProtectionError> {
        let request = nook_core::passkey_assertion_request(record)?;
        Ok(Self {
            credential_id: request.credential_id().to_vec(),
            prf_input: request.prf_input().to_vec(),
        })
    }
}

#[wasm_bindgen]
impl NookPasskeyUnlockOptions {
    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> Vec<u8> {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen(js_name = requestOptions)]
    pub fn request_options(
        &self,
        rp_id: &str,
    ) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> {
        crate::passkey_browser::request_options(rp_id, &self.credential_id, &self.prf_input)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookJoinRequest {
    device_id: String,
    public_key: String,
    requested_at: String,
}

#[wasm_bindgen]
impl NookJoinRequest {
    pub(crate) fn from_core(join: nook_core::JoinRequest) -> Self {
        Self {
            device_id: join.device_id.to_string(),
            public_key: join.public_key.as_str().to_owned(),
            requested_at: join.requested_at,
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = requestedAt)]
    pub fn requested_at(&self) -> String {
        self.requested_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultMember {
    auth_id: String,
    device_id: String,
    public_key: String,
    enrolled_at: String,
    label: String,
}

#[wasm_bindgen]
impl NookVaultMember {
    pub(crate) fn from_core(member: nook_core::VaultMember) -> Self {
        Self {
            auth_id: member.auth_id.to_string(),
            device_id: member.device_id.to_string(),
            public_key: member.public_key.as_str().to_owned(),
            enrolled_at: member.enrolled_at,
            label: member.label.unwrap_or_default(),
        }
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = enrolledAt)]
    pub fn enrolled_at(&self) -> String {
        self.enrolled_at.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasswordEntrySummary {
    id: String,
    label: String,
    created_at: String,
}

#[wasm_bindgen]
impl NookPasswordEntrySummary {
    pub(crate) fn from_core(entry: &nook_core::PasswordUnlockEntry) -> Self {
        Self {
            id: entry.id.clone(),
            label: entry.label.clone(),
            created_at: entry.created_at.clone(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> String {
        self.created_at.clone()
    }
}

pub(crate) fn password_entries_to_vec(
    entries: &[nook_core::PasswordUnlockEntry],
) -> Vec<NookPasswordEntrySummary> {
    entries
        .iter()
        .map(NookPasswordEntrySummary::from_core)
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookEnrollmentProvider(nook_core::EnrollmentProvider);

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::local(),
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::github(pat, repo),
        ))
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn oauth_file(
        preset: String,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<String>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
    ) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::oauth_file(
                preset,
                access_token,
                refresh_token,
                expires_at,
                file_id,
                file_name,
                account_email,
            ),
        ))
    }

    #[wasm_bindgen(js_name = sharedProviderGrant)]
    #[must_use]
    pub fn shared_provider_grant(
        sync_provider_type: String,
        oauth_preset: Option<String>,
        joiner_identity_kind: String,
        joiner_identity: String,
        storage_target_id: Option<String>,
    ) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::legacy_google_drive(
                sync_provider_type,
                oauth_preset,
                joiner_identity_kind,
                joiner_identity,
                storage_target_id,
            ),
        ))
    }

    #[wasm_bindgen(js_name = iCloudShared)]
    #[must_use]
    pub fn icloud_shared(storage_target_id: String) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::icloud(storage_target_id),
        ))
    }

    pub(crate) fn from_core(provider: nook_core::EnrollmentProvider) -> Self {
        Self(provider)
    }

    pub(crate) fn to_core(&self) -> nook_core::EnrollmentProvider {
        self.0.clone()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    #[must_use]
    pub fn provider_type(&self) -> nook_core::StorageProviderType {
        match &self.0 {
            nook_core::EnrollmentProvider::PersonalCredentialTransfer(provider) => {
                match provider.data() {
                    nook_core::PersonalEnrollmentProviderData::Local => {
                        nook_core::StorageProviderType::Local
                    }
                    nook_core::PersonalEnrollmentProviderData::Github { .. } => {
                        nook_core::StorageProviderType::Github
                    }
                    nook_core::PersonalEnrollmentProviderData::OauthFile { .. } => {
                        nook_core::StorageProviderType::OauthFile
                    }
                }
            }
            nook_core::EnrollmentProvider::SharedProviderGrant(_) => {
                nook_core::StorageProviderType::OauthFile
            }
        }
    }

    #[wasm_bindgen(getter, js_name = isSharedProviderGrant)]
    #[must_use]
    pub fn is_shared_provider_grant(&self) -> bool {
        matches!(
            self.0,
            nook_core::EnrollmentProvider::SharedProviderGrant(_)
        )
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        nook_core::enrollment_provider_onboarding_type(&self.0)
    }

    #[wasm_bindgen(getter, js_name = githubPat)]
    pub fn github_pat(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::Github { pat, .. }) => {
                Some(pat.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = githubRepo)]
    pub fn github_repo(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::Github { repo, .. }) => {
                Some(repo.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> Option<String> {
        match (&self.0.personal_data(), &self.0.shared_data()) {
            (Some(nook_core::PersonalEnrollmentProviderData::OauthFile { preset, .. }), _) => {
                Some(preset.clone())
            }
            (
                _,
                Some(nook_core::SharedEnrollmentProviderData::GoogleDrive { oauth_preset, .. }),
            ) => oauth_preset.clone(),
            (_, Some(nook_core::SharedEnrollmentProviderData::ICloud { .. })) => {
                Some("icloud".to_owned())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccessToken)]
    pub fn oauth_access_token(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { access_token, .. }) => {
                Some(access_token.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthRefreshToken)]
    pub fn oauth_refresh_token(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile {
                refresh_token, ..
            }) => refresh_token.clone(),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthExpiresAt)]
    pub fn oauth_expires_at(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { expires_at, .. }) => {
                expires_at.clone()
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFileId)]
    pub fn oauth_file_id(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { file_id, .. }) => {
                file_id.clone()
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFileName)]
    pub fn oauth_file_name(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { file_name, .. }) => {
                file_name.clone()
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccountEmail)]
    pub fn oauth_account_email(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile {
                account_email, ..
            }) => account_email.clone(),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentityKind)]
    pub fn shared_joiner_identity_kind(&self) -> Option<String> {
        match self.0.shared_data() {
            Some(nook_core::SharedEnrollmentProviderData::GoogleDrive {
                joiner_identity_kind,
                ..
            }) => Some(joiner_identity_kind.clone()),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> Option<String> {
        match self.0.shared_data() {
            Some(nook_core::SharedEnrollmentProviderData::GoogleDrive {
                joiner_identity, ..
            }) => Some(joiner_identity.clone()),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = sharedStorageTargetId)]
    pub fn shared_storage_target_id(&self) -> Option<String> {
        match self.0.shared_data() {
            Some(nook_core::SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => storage_target_id.clone(),
            Some(nook_core::SharedEnrollmentProviderData::ICloud { storage_target_id }) => {
                Some(storage_target_id.clone())
            }
            None => None,
        }
    }
}

/// Thin wasm newtype wrapper over the core `SyncProviderTarget` enum. Construct
/// via the variant constructors; read via `is_*` / `as_*` accessors.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSyncProviderTarget(nook_core::SyncProviderTarget);

#[wasm_bindgen]
impl NookSyncProviderTarget {
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = localFolder)]
    #[must_use]
    pub fn local_folder(directory_name: Option<String>, handle_id: Option<String>) -> Self {
        Self(nook_core::SyncProviderTarget::LocalFolder(
            nook_core::LocalFolderSyncTarget {
                directory_name,
                handle_id,
            },
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::SyncProviderTarget::Github(
            nook_core::GithubSyncTarget { repo, pat },
        ))
    }

    #[wasm_bindgen(js_name = empty)]
    #[must_use]
    pub fn empty() -> Self {
        Self(nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn oauth_file(
        preset: Option<String>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
        access_token: Option<String>,
        folder_id: Option<String>,
    ) -> Result<NookSyncProviderTarget, wasm_bindgen::JsError> {
        let preset = preset
            .as_deref()
            .map(nook_core::OauthFilePreset::parse)
            .transpose()?
            .unwrap_or(nook_core::OauthFilePreset::GoogleDrive);
        Ok(Self(nook_core::SyncProviderTarget::OauthFile(
            nook_core::OauthFileSyncTarget {
                preset,
                file_id,
                folder_id,
                file_name,
                account_email,
                access_token,
            },
        )))
    }

    #[wasm_bindgen(js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = isLocalFolder)]
    #[must_use]
    pub fn is_local_folder(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::LocalFolder(_))
    }

    #[wasm_bindgen(js_name = isGithub)]
    #[must_use]
    pub fn is_github(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Github(_))
    }

    #[wasm_bindgen(js_name = isEmpty)]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = isOauthFile)]
    #[must_use]
    pub fn is_oauth_file(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::OauthFile(_))
    }
}

impl From<nook_core::SyncProviderTarget> for NookSyncProviderTarget {
    fn from(target: nook_core::SyncProviderTarget) -> Self {
        Self(target)
    }
}

#[wasm_bindgen]
pub struct NookEnrollmentIssueInput {
    provider: NookEnrollmentProvider,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookEnrollmentIssueInput {
    #[wasm_bindgen(constructor)]
    pub fn new(provider: NookEnrollmentProvider, entry_id: String, issued_at: String) -> Self {
        Self {
            provider,
            entry_id,
            issued_at,
        }
    }

    pub(crate) fn to_core(
        &self,
    ) -> Result<nook_core::EnrollmentIssueInput, nook_core::EnrollmentError> {
        Ok(nook_core::EnrollmentIssueInput {
            provider: self.provider.to_core(),
            entry_id: self.entry_id.clone(),
            issued_at: self.issued_at.clone(),
        })
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDecryptedEnrollmentPayload {
    provider: NookEnrollmentProvider,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookDecryptedEnrollmentPayload {
    pub(crate) fn from_core(payload: nook_core::DecryptedEnrollmentPayload) -> Self {
        Self {
            provider: NookEnrollmentProvider::from_core(payload.provider),
            entry_id: payload.entry_id,
            issued_at: payload.issued_at,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        self.provider.onboarding_type()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultSyncResult {
    changed: bool,
    access_status: String,
    secrets: Vec<NookSecretRecord>,
    pending_joins: Vec<NookJoinRequest>,
    vault_members: Vec<NookVaultMember>,
}

#[wasm_bindgen]
impl NookVaultSyncResult {
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    #[wasm_bindgen(getter, js_name = accessStatus)]
    pub fn access_status(&self) -> String {
        self.access_status.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn secrets(&self) -> Vec<NookSecretRecord> {
        self.secrets.clone()
    }

    #[wasm_bindgen(getter, js_name = pendingJoins)]
    pub fn pending_joins(&self) -> Vec<NookJoinRequest> {
        self.pending_joins.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultMembers)]
    pub fn vault_members(&self) -> Vec<NookVaultMember> {
        self.vault_members.clone()
    }

    pub(crate) fn unchanged() -> Self {
        Self {
            changed: false,
            access_status: String::new(),
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn with_access_status(status: String) -> Self {
        Self {
            changed: true,
            access_status: status,
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn session(manager: &NookVaultManager, changed: bool) -> Result<Self, NookError> {
        Ok(Self {
            changed,
            access_status: String::new(),
            secrets: Vec::new(),
            pending_joins: manager.pending_joins().unwrap_or_default(),
            vault_members: manager.vault_members().unwrap_or_default(),
        })
    }
}

#[wasm_bindgen]
pub struct NookSecretPage {
    items: Vec<NookSecretListItem>,
    total: u32,
    offset: u32,
    limit: u32,
}

impl NookSecretPage {
    pub(crate) fn from_core(page: nook_core::SecretPage) -> Result<Self, NookError> {
        Ok(Self {
            items: list_items_to_vec(page.records),
            total: u32::try_from(page.total).unwrap_or(u32::MAX),
            offset: u32::try_from(page.offset).unwrap_or(u32::MAX),
            limit: u32::try_from(page.limit).unwrap_or(u32::MAX),
        })
    }
}

#[wasm_bindgen]
impl NookSecretPage {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn total(&self) -> u32 {
        self.total
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn offset(&self) -> u32 {
        self.offset
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn limit(&self) -> u32 {
        self.limit
    }

    /// Transfer page-owned metadata items to JavaScript without cloning them.
    #[wasm_bindgen(js_name = takeItems)]
    pub fn take_items(&mut self) -> Vec<NookSecretListItem> {
        std::mem::take(&mut self.items)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookImportResult {
    imported: u32,
    skipped_unsupported: u32,
    skipped_duplicates: u32,
}

#[wasm_bindgen]
impl NookImportResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn imported(&self) -> u32 {
        self.imported
    }

    #[wasm_bindgen(getter, js_name = skippedUnsupported)]
    #[must_use]
    pub fn skipped_unsupported(&self) -> u32 {
        self.skipped_unsupported
    }

    #[wasm_bindgen(getter, js_name = skippedDuplicates)]
    #[must_use]
    pub fn skipped_duplicates(&self) -> u32 {
        self.skipped_duplicates
    }

    pub(crate) fn new(
        imported: usize,
        skipped_unsupported: usize,
        skipped_duplicates: usize,
    ) -> Self {
        Self {
            imported: u32::try_from(imported).unwrap_or(u32::MAX),
            skipped_unsupported: u32::try_from(skipped_unsupported).unwrap_or(u32::MAX),
            skipped_duplicates: u32::try_from(skipped_duplicates).unwrap_or(u32::MAX),
        }
    }
}

/// Flat form payload for `buildSecretYaml` — unused fields stay empty.
#[wasm_bindgen]
pub struct NookSecretFormFields {
    website_url: String,
    username: String,
    password: String,
    notes: String,
    key: String,
    expires_at: String,
    name: String,
    seed: String,
    title: String,
    note: String,
    issuer: String,
    account: String,
    totp_secret: String,
    algorithm: String,
    digits: String,
    period: String,
    backup_codes: String,
}

#[wasm_bindgen]
impl NookSecretFormFields {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        website_url: Option<String>,
        username: Option<String>,
        password: Option<String>,
        notes: Option<String>,
        key: Option<String>,
        expires_at: Option<String>,
        name: Option<String>,
        seed: Option<String>,
        title: Option<String>,
        note: Option<String>,
        issuer: Option<String>,
        account: Option<String>,
        totp_secret: Option<String>,
        algorithm: Option<String>,
        digits: Option<String>,
        period: Option<String>,
        backup_codes: Option<String>,
    ) -> Self {
        Self {
            website_url: website_url.unwrap_or_default(),
            username: username.unwrap_or_default(),
            password: password.unwrap_or_default(),
            notes: notes.unwrap_or_default(),
            key: key.unwrap_or_default(),
            expires_at: expires_at.unwrap_or_default(),
            name: name.unwrap_or_default(),
            seed: seed.unwrap_or_default(),
            title: title.unwrap_or_default(),
            note: note.unwrap_or_default(),
            issuer: issuer.unwrap_or_default(),
            account: account.unwrap_or_default(),
            totp_secret: totp_secret.unwrap_or_default(),
            algorithm: algorithm.unwrap_or_default(),
            digits: digits.unwrap_or_default(),
            period: period.unwrap_or_default(),
            backup_codes: backup_codes.unwrap_or_default(),
        }
    }

    pub(crate) fn to_json_value(&self) -> serde_json::Value {
        serde_json::json!({
            "websiteUrl": self.website_url,
            "username": self.username,
            "password": self.password,
            "notes": self.notes,
            "key": self.key,
            "expiresAt": self.expires_at,
            "name": self.name,
            "seed": self.seed,
            "title": self.title,
            "note": self.note,
            "issuer": self.issuer,
            "account": self.account,
            "totpSecret": self.totp_secret,
            "algorithm": self.algorithm,
            "digits": self.digits,
            "period": self.period,
            "backupCodes": self.backup_codes,
        })
    }
}

#[wasm_bindgen]
pub struct NookTotpCode {
    code: String,
    seconds_remaining: u32,
    period: u32,
}

#[wasm_bindgen]
impl NookTotpCode {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    #[wasm_bindgen(getter, js_name = secondsRemaining)]
    #[must_use]
    pub fn seconds_remaining(&self) -> u32 {
        self.seconds_remaining
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn period(&self) -> u32 {
        self.period
    }

    pub(crate) fn from_core(value: nook_core::TotpCode) -> Self {
        Self {
            code: value.code,
            seconds_remaining: u32::try_from(value.seconds_remaining).unwrap_or(u32::MAX),
            period: u32::try_from(value.period).unwrap_or(u32::MAX),
        }
    }
}

pub(crate) fn records_to_vec(
    records: Vec<nook_core::SecretRecord>,
) -> Result<Vec<NookSecretRecord>, NookError> {
    Ok(records
        .into_iter()
        .map(NookSecretRecord::from_record)
        .collect())
}

pub(crate) fn list_items_to_vec(items: Vec<nook_core::SecretListItem>) -> Vec<NookSecretListItem> {
    items
        .into_iter()
        .map(NookSecretListItem::from_core)
        .collect()
}

pub(crate) fn joins_to_vec(joins: Vec<nook_core::JoinRequest>) -> Vec<NookJoinRequest> {
    joins.into_iter().map(NookJoinRequest::from_core).collect()
}

pub(crate) fn members_to_vec(members: Vec<nook_core::VaultMember>) -> Vec<NookVaultMember> {
    members
        .into_iter()
        .map(NookVaultMember::from_core)
        .collect()
}

/// Pending browser sync resolution state.
///
/// The comparison comes from core, but this object also carries the provider
/// handle needed to resume the paused web storage operation.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPendingSyncConflict {
    provider_id: String,
    provider_label: String,
    local_yaml: String,
    remote_yaml: String,
    local_version: f64,
    remote_version: f64,
    mode: String,
    pat: String,
    repo: String,
    remote_revision: Option<String>,
    kind: String,
    local_store_id: Option<String>,
    remote_store_id: Option<String>,
}

#[wasm_bindgen]
impl NookPendingSyncConflict {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        local_version: f64,
        remote_version: f64,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: Option<String>,
        kind: Option<String>,
        local_store_id: Option<String>,
        remote_store_id: Option<String>,
    ) -> Self {
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            local_version,
            remote_version,
            mode,
            pat,
            repo,
            remote_revision,
            kind: if kind.unwrap_or_default() == "store_id" {
                "store_id".to_owned()
            } else {
                "content".to_owned()
            },
            local_store_id,
            remote_store_id,
        }
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> String {
        self.provider_id.clone()
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> String {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = localYaml)]
    pub fn local_yaml(&self) -> String {
        self.local_yaml.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteYaml)]
    pub fn remote_yaml(&self) -> String {
        self.remote_yaml.clone()
    }

    #[wasm_bindgen(getter, js_name = localVersion)]
    pub fn local_version(&self) -> f64 {
        self.local_version
    }

    #[wasm_bindgen(getter, js_name = remoteVersion)]
    pub fn remote_version(&self) -> f64 {
        self.remote_version
    }

    #[wasm_bindgen(getter)]
    pub fn mode(&self) -> String {
        self.mode.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteRevision)]
    pub fn remote_revision(&self) -> Option<String> {
        self.remote_revision.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.clone()
    }

    #[wasm_bindgen(getter, js_name = localStoreId)]
    pub fn local_store_id(&self) -> Option<String> {
        self.local_store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteStoreId)]
    pub fn remote_store_id(&self) -> Option<String> {
        self.remote_store_id.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementConflict {
    old_secret_id: String,
    candidates_json: String,
}

#[wasm_bindgen]
impl NookReplacementConflict {
    #[wasm_bindgen(getter, js_name = oldSecretId)]
    pub fn old_secret_id(&self) -> String {
        self.old_secret_id.clone()
    }

    #[wasm_bindgen(getter, js_name = candidatesJson)]
    pub fn candidates_json(&self) -> String {
        self.candidates_json.clone()
    }
}

pub(crate) fn replacement_conflicts_to_vec(
    conflicts: std::collections::BTreeMap<
        nook_core::SecretId,
        nook_core::SecretReplacementConflict,
    >,
) -> Result<Vec<NookReplacementConflict>, NookError> {
    conflicts
        .into_values()
        .map(|conflict| {
            let candidates_json = serde_json::to_string(
                &conflict
                    .candidates
                    .iter()
                    .map(|(event_id, secret_id)| {
                        (event_id.as_str().to_owned(), secret_id.as_str().to_owned())
                    })
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            Ok(NookReplacementConflict {
                old_secret_id: conflict.old_secret_id.as_str().to_owned(),
                candidates_json,
            })
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecurityConflict {
    events_json: String,
    reasons_json: String,
}

#[wasm_bindgen]
impl NookSecurityConflict {
    #[wasm_bindgen(getter, js_name = eventsJson)]
    pub fn events_json(&self) -> String {
        self.events_json.clone()
    }

    #[wasm_bindgen(getter, js_name = reasonsJson)]
    pub fn reasons_json(&self) -> String {
        self.reasons_json.clone()
    }
}

pub(crate) fn security_conflicts_to_vec(
    conflicts: Vec<nook_core::SecurityConflict>,
) -> Result<Vec<NookSecurityConflict>, NookError> {
    conflicts
        .into_iter()
        .map(|conflict| {
            let events_json = serde_json::to_string(
                &conflict
                    .events
                    .iter()
                    .map(|event| event.as_str().to_owned())
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            let reasons_json = serde_json::to_string(
                &conflict
                    .reasons
                    .iter()
                    .map(|reason| reason.as_str())
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| NookError::Serialization(e.to_string()))?;
            Ok(NookSecurityConflict {
                events_json,
                reasons_json,
            })
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultAccessReport {
    device_id: String,
    auth_id: String,
    key_status: String,
    key_explanation: String,
    current_epoch: Option<String>,
    auth_key_ids_json: String,
    epoch_history_json: String,
    secrets_json: String,
    events_json: String,
    warnings_json: String,
}

#[wasm_bindgen]
impl NookVaultAccessReport {
    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = keyStatus)]
    pub fn key_status(&self) -> String {
        self.key_status.clone()
    }

    #[wasm_bindgen(getter, js_name = keyExplanation)]
    pub fn key_explanation(&self) -> String {
        self.key_explanation.clone()
    }

    #[wasm_bindgen(getter, js_name = currentEpoch)]
    pub fn current_epoch(&self) -> Option<String> {
        self.current_epoch.clone()
    }

    #[wasm_bindgen(getter, js_name = authKeyIdsJson)]
    pub fn auth_key_ids_json(&self) -> String {
        self.auth_key_ids_json.clone()
    }

    #[wasm_bindgen(getter, js_name = epochHistoryJson)]
    pub fn epoch_history_json(&self) -> String {
        self.epoch_history_json.clone()
    }

    #[wasm_bindgen(getter, js_name = secretsJson)]
    pub fn secrets_json(&self) -> String {
        self.secrets_json.clone()
    }

    #[wasm_bindgen(getter, js_name = eventsJson)]
    pub fn events_json(&self) -> String {
        self.events_json.clone()
    }

    #[wasm_bindgen(getter, js_name = warningsJson)]
    pub fn warnings_json(&self) -> String {
        self.warnings_json.clone()
    }

    pub(crate) fn from_core(
        report: nook_core::VaultAccessDiagnosticsReport,
    ) -> Result<Self, NookError> {
        let auth_key_ids_json = serde_json::to_string(
            &report
                .auth_key_ids
                .iter()
                .map(|auth_id| auth_id.as_str().to_owned())
                .collect::<Vec<_>>(),
        )
        .map_err(|e| NookError::Serialization(e.to_string()))?;
        let epoch_history_json = serde_json::to_string(&report.epoch_history)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let secrets_json = serde_json::to_string(&report.secrets)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let events_json = serde_json::to_string(&report.events)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let warnings_json = serde_json::to_string(&report.warnings)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        Ok(Self {
            device_id: report.key_access.device_id.as_str().to_owned(),
            auth_id: report.key_access.auth_id.as_str().to_owned(),
            key_status: report.key_access.status.as_str().to_owned(),
            key_explanation: report.key_access.explanation,
            current_epoch: report.current_epoch,
            auth_key_ids_json,
            epoch_history_json,
            secrets_json,
            events_json,
            warnings_json,
        })
    }
}
