use super::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookProviderSyncRevisionState {
    Untracked,
    Tracked,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookProviderSyncRevision(nook_core::ProviderSyncRevision);

#[wasm_bindgen]
impl NookProviderSyncRevision {
    #[wasm_bindgen(js_name = untracked)]
    #[must_use]
    pub fn untracked() -> Self {
        Self(nook_core::ProviderSyncRevision::Unknown)
    }

    #[wasm_bindgen(js_name = tracked)]
    #[must_use]
    pub fn tracked(revision: String) -> Self {
        Self(nook_core::ProviderSyncRevision::Revision(revision))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookProviderSyncRevisionState {
        match &self.0 {
            nook_core::ProviderSyncRevision::Unknown => NookProviderSyncRevisionState::Untracked,
            nook_core::ProviderSyncRevision::Revision(_) => NookProviderSyncRevisionState::Tracked,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::ProviderSyncRevision::Unknown => {
                Err(wasm_bindgen::JsError::new("provider revision is untracked"))
            }
            nook_core::ProviderSyncRevision::Revision(revision) => Ok(revision.clone()),
        }
    }
}

impl NookProviderSyncRevision {
    pub(crate) fn as_core(&self) -> nook_core::ProviderSyncRevisionRef<'_> {
        match &self.0 {
            nook_core::ProviderSyncRevision::Unknown => {
                nook_core::ProviderSyncRevisionRef::Unreported
            }
            nook_core::ProviderSyncRevision::Revision(revision) => {
                nook_core::ProviderSyncRevisionRef::Revision(revision)
            }
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookManagerStoreScopeState {
    Unscoped,
    Scoped,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookManagerStoreScope(ManagerStoreScope);

#[derive(Clone)]
enum ManagerStoreScope {
    Unscoped,
    Scoped(String),
}

#[wasm_bindgen]
impl NookManagerStoreScope {
    #[wasm_bindgen(js_name = unscoped)]
    #[must_use]
    pub fn unscoped() -> Self {
        Self(ManagerStoreScope::Unscoped)
    }

    #[wasm_bindgen(js_name = scoped)]
    #[must_use]
    pub fn scoped(store_id: String) -> Self {
        Self(ManagerStoreScope::Scoped(store_id))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookManagerStoreScopeState {
        match &self.0 {
            ManagerStoreScope::Unscoped => NookManagerStoreScopeState::Unscoped,
            ManagerStoreScope::Scoped(_) => NookManagerStoreScopeState::Scoped,
        }
    }

    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            ManagerStoreScope::Unscoped => Err(wasm_bindgen::JsError::new(
                "manager store scope is unscoped",
            )),
            ManagerStoreScope::Scoped(store_id) => Ok(store_id.clone()),
        }
    }
}

impl NookManagerStoreScope {
    pub(crate) fn as_core(&self) -> nook_core::ManagerStoreScopeRef<'_> {
        match &self.0 {
            ManagerStoreScope::Unscoped => nook_core::ManagerStoreScopeRef::Unscoped,
            ManagerStoreScope::Scoped(store_id) => nook_core::ManagerStoreScopeRef::Store(store_id),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultArchitecture(nook_core::VaultArchitecture);

#[wasm_bindgen]
impl NookVaultArchitecture {
    #[wasm_bindgen(js_name = draft)]
    pub fn draft(
        device_mode: nook_core::DeviceMode,
        vault_type: nook_core::VaultType,
        replication_type: nook_core::ReplicationType,
    ) -> Result<Self, wasm_bindgen::JsError> {
        Ok(Self(nook_core::VaultArchitecture::draft(
            device_mode,
            vault_type,
            replication_type,
        )?))
    }

    #[wasm_bindgen(js_name = simple)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn simple(
        device_mode: nook_core::DeviceMode,
        replication_type: nook_core::ReplicationType,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let architecture = nook_core::VaultArchitecture {
            device_mode,
            vault_type: nook_core::VaultType::Simple,
            replication_type,
            sentinel: nook_core::SentinelConfiguration::Disabled,
        };
        architecture.validate()?;
        Ok(Self(architecture))
    }

    #[wasm_bindgen(js_name = sentinel)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn sentinel(
        device_mode: nook_core::DeviceMode,
        replication_type: nook_core::ReplicationType,
        threshold: u8,
        required_participants: u8,
        ready_participants: u8,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let architecture = nook_core::VaultArchitecture {
            device_mode,
            vault_type: nook_core::VaultType::Sentinel,
            replication_type,
            sentinel: nook_core::SentinelConfiguration::Enabled(nook_core::SentinelPolicy {
                threshold,
                required_participants,
                ready_participants,
            }),
        };
        architecture.validate()?;
        Ok(Self(architecture))
    }

    #[wasm_bindgen(getter, js_name = device_mode)]
    pub fn device_mode(&self) -> nook_core::DeviceMode {
        self.0.device_mode
    }

    #[wasm_bindgen(getter, js_name = vault_type)]
    pub fn vault_type(&self) -> nook_core::VaultType {
        self.0.vault_type
    }

    #[wasm_bindgen(getter, js_name = replication_type)]
    pub fn replication_type(&self) -> nook_core::ReplicationType {
        self.0.replication_type
    }

    #[wasm_bindgen(getter, js_name = sentinel_threshold)]
    pub fn sentinel_threshold(&self) -> Result<u8, wasm_bindgen::JsError> {
        Ok(self.0.sentinel.policy()?.threshold)
    }

    #[wasm_bindgen(getter, js_name = sentinel_required_participants)]
    pub fn sentinel_required_participants(&self) -> Result<u8, wasm_bindgen::JsError> {
        Ok(self.0.sentinel.policy()?.required_participants)
    }

    #[wasm_bindgen(getter, js_name = sentinel_ready_participants)]
    pub fn sentinel_ready_participants(&self) -> Result<u8, wasm_bindgen::JsError> {
        Ok(self.0.sentinel.policy()?.ready_participants)
    }
}

impl NookVaultArchitecture {
    pub(crate) fn from_core(value: nook_core::VaultArchitecture) -> Self {
        Self(value)
    }

    pub(crate) fn to_core(&self) -> nook_core::VaultArchitecture {
        self.0.clone()
    }
}

#[wasm_bindgen]
pub struct NookProviderReplicationCapability(nook_core::ProviderReplicationCapability);

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookProviderOAuthPresetState {
    NotApplicable,
    Preset,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookProviderJoinerIdentityState {
    NotRequired,
    Required,
}

#[wasm_bindgen]
impl NookProviderReplicationCapability {
    pub(crate) fn from_core(value: nook_core::ProviderReplicationCapability) -> Self {
        Self(value)
    }

    #[wasm_bindgen(getter, js_name = providerType)]
    pub fn provider_type(&self) -> String {
        self.0.provider_type.clone()
    }

    #[wasm_bindgen(getter, js_name = oauthPresetState)]
    pub fn oauth_preset_state(&self) -> NookProviderOAuthPresetState {
        match self.0.oauth_preset {
            nook_core::ProviderOauthPreset::NotApplicable => {
                NookProviderOAuthPresetState::NotApplicable
            }
            nook_core::ProviderOauthPreset::Preset(_) => NookProviderOAuthPresetState::Preset,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.oauth_preset {
            nook_core::ProviderOauthPreset::NotApplicable => {
                Err(wasm_bindgen::JsError::new("OAuth preset is not applicable"))
            }
            nook_core::ProviderOauthPreset::Preset(preset) => Ok(preset.as_str().to_owned()),
        }
    }

    #[wasm_bindgen(getter, js_name = supportsPersonal)]
    pub fn supports_personal(&self) -> bool {
        self.0.supports_personal
    }

    #[wasm_bindgen(getter, js_name = supportsShared)]
    pub fn supports_shared(&self) -> bool {
        self.0.supports_shared
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentityState)]
    pub fn shared_joiner_identity_state(&self) -> NookProviderJoinerIdentityState {
        match self.0.shared_joiner_identity {
            nook_core::ProviderJoinerIdentity::NotRequired => {
                NookProviderJoinerIdentityState::NotRequired
            }
            nook_core::ProviderJoinerIdentity::Required(_) => {
                NookProviderJoinerIdentityState::Required
            }
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.0.shared_joiner_identity {
            nook_core::ProviderJoinerIdentity::NotRequired => Err(wasm_bindgen::JsError::new(
                "shared joiner identity is not required",
            )),
            nook_core::ProviderJoinerIdentity::Required(kind) => Ok(kind.as_str().to_owned()),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookAuthenticatorAccount {
    secret_id: String,
    issuer: String,
    account: String,
}

/// Non-secret preview of a validated authenticator enrollment URI.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookOtpauthPreview {
    issuer: String,
    account: String,
    website_url: String,
    algorithm: String,
    digits: u32,
    period: u32,
}

#[wasm_bindgen]
impl NookOtpauthPreview {
    pub(crate) fn from_core(preview: nook_core::OtpauthPreview) -> Self {
        Self {
            issuer: preview.issuer,
            account: preview.account,
            website_url: preview.website_url,
            algorithm: preview.algorithm.as_str().to_owned(),
            digits: preview.digits.get(),
            period: u32::try_from(preview.period.get()).unwrap_or(u32::MAX),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        self.issuer.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        self.account.clone()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        self.website_url.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn algorithm(&self) -> String {
        self.algorithm.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn digits(&self) -> u32 {
        self.digits
    }

    #[wasm_bindgen(getter)]
    pub fn period(&self) -> u32 {
        self.period
    }
}

#[wasm_bindgen]
impl NookAuthenticatorAccount {
    pub(crate) fn from_authenticator(
        id: &nook_core::SecretId,
        authenticator: &nook_core::AuthenticatorSecret,
    ) -> Self {
        Self {
            secret_id: id.to_string(),
            issuer: authenticator.issuer.clone(),
            account: authenticator.account.clone(),
        }
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        self.issuer.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        self.account.clone()
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
