//! Portable classification and safe identifiers for the Devices & access surface.
//!
//! Browser ceremony details are observations, never authorization policy. This
//! module keeps protection naming and safe passkey identifiers consistent for
//! every host without exposing credential bytes or private device material.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use std::{error, fmt};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::errors::ValidationError;
use crate::{DeviceId, IsoTimestamp, StoreId};

mod actions;
mod credential_profile;
pub use credential_profile::*;
mod passkey_keeper;
mod passkey_observation;

pub use actions::*;
pub use passkey_keeper::PasskeyKeeperKind;
pub use passkey_observation::*;

pub const DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS: usize = 80;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct DeviceAccessProfileVersion(u32);

impl DeviceAccessProfileVersion {
    #[must_use]
    pub const fn is_current(self) -> bool {
        self.0 == DEVICE_ACCESS_PROFILE_VERSION.0
    }

    #[must_use]
    pub const fn is_future(self) -> bool {
        self.0 > DEVICE_ACCESS_PROFILE_VERSION.0
    }
}

pub const DEVICE_ACCESS_PROFILE_VERSION: DeviceAccessProfileVersion = DeviceAccessProfileVersion(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessProviderLabelError {
    TooLong,
    ContainsControlCharacter,
}

impl fmt::Display for DeviceAccessProviderLabelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLong => formatter.write_str("passkey provider label is too long"),
            Self::ContainsControlCharacter => {
                formatter.write_str("passkey provider label contains a control character")
            }
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessProtectionKind {
    Missing,
    CompanionSession,
    PasskeyStandard,
    PasskeyAntiHacker,
    PinOrPassphrase,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessCredentialKind {
    Unavailable,
    CompanionSession,
    Passkey,
    PinOrPassphrase,
}

impl DeviceAccessProtectionKind {
    #[must_use]
    pub const fn credential_kind(self) -> DeviceAccessCredentialKind {
        match self {
            Self::Missing => DeviceAccessCredentialKind::Unavailable,
            Self::CompanionSession => DeviceAccessCredentialKind::CompanionSession,
            Self::PasskeyStandard | Self::PasskeyAntiHacker => DeviceAccessCredentialKind::Passkey,
            Self::PinOrPassphrase => DeviceAccessCredentialKind::PinOrPassphrase,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessIdentityState {
    Missing,
    Locked,
    Unlocked,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(from = "PasskeyAccessProfileWire")]
#[serde(rename_all = "camelCase")]
pub struct PasskeyAccessProfile {
    #[serde(default)]
    pub credential_fingerprint: String,
    #[serde(default)]
    pub nook_name: String,
    #[serde(default)]
    pub provider_label: String,
    #[serde(default)]
    pub created_at: PasskeyCreatedAtEvidence,
    #[serde(default)]
    pub last_used_at: PasskeyLastUsedAtEvidence,
    #[serde(default)]
    pub observation: PasskeyBrowserObservation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyAccessProfileWire {
    #[serde(default)]
    credential_fingerprint: String,
    #[serde(default)]
    nook_name: String,
    #[serde(default)]
    provider_label: String,
    #[serde(default)]
    created_at: passkey_observation::PasskeyCreatedAtEvidenceWire,
    #[serde(default)]
    last_used_at: passkey_observation::PasskeyLastUsedAtEvidenceWire,
    #[serde(default)]
    observation: PasskeyBrowserObservation,
}
impl From<PasskeyAccessProfileWire> for PasskeyAccessProfile {
    fn from(wire: PasskeyAccessProfileWire) -> Self {
        Self {
            credential_fingerprint: wire.credential_fingerprint,
            nook_name: wire.nook_name,
            provider_label: wire.provider_label,
            created_at: wire.created_at.into(),
            last_used_at: wire.last_used_at.into(),
            observation: wire.observation,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(try_from = "VerifiedVaultAccessWire")]
#[serde(rename_all = "camelCase")]
pub struct VerifiedVaultAccess {
    pub device_id: DeviceId,
    pub store_id: StoreId,
    pub verified_at: IsoTimestamp,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifiedVaultAccessWire {
    device_id: String,
    store_id: String,
    verified_at: IsoTimestamp,
}
impl TryFrom<VerifiedVaultAccessWire> for VerifiedVaultAccess {
    type Error = ValidationError;
    fn try_from(wire: VerifiedVaultAccessWire) -> Result<Self, Self::Error> {
        Ok(Self {
            device_id: DeviceId::parse(&wire.device_id)?,
            store_id: StoreId::parse(&wire.store_id)?,
            verified_at: wire.verified_at,
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAccessProfile {
    pub version: DeviceAccessProfileVersion,
    #[serde(
        default,
        rename = "passkey",
        skip_serializing_if = "DeviceCredentialProfile::is_unrecorded"
    )]
    pub credential: DeviceCredentialProfile,
    #[serde(default)]
    pub verified_vaults: Vec<VerifiedVaultAccess>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeviceAccessProfileDecodeResult {
    Current(Box<DeviceAccessProfile>),
    RecoverableDefault,
    FutureVersion,
}

#[derive(Deserialize)]
struct DeviceAccessProfileVersionEnvelope {
    version: DeviceAccessProfileVersion,
}

impl Default for DeviceAccessProfile {
    fn default() -> Self {
        Self {
            version: DEVICE_ACCESS_PROFILE_VERSION,
            credential: DeviceCredentialProfile::Unrecorded,
            verified_vaults: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceAccessProfileTransitionError {
    CredentialChanged,
}

impl fmt::Display for DeviceAccessProfileTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CredentialChanged => {
                formatter.write_str("passkey changed before its metadata was saved")
            }
        }
    }
}

impl error::Error for DeviceAccessProfileTransitionError {}

#[derive(Debug, PartialEq, Eq)]
pub struct DeviceAccessProfileRejection {
    pub profile: DeviceAccessProfile,
    pub cause: DeviceAccessProfileTransitionError,
}
impl fmt::Display for DeviceAccessProfileRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.cause.fmt(formatter)
    }
}
impl error::Error for DeviceAccessProfileRejection {}

impl DeviceAccessProfile {
    #[allow(clippy::result_large_err)]
    pub fn set_passkey_name(
        mut self,
        credential_fingerprint: &str,
        name: String,
    ) -> Result<Self, DeviceAccessProfileRejection> {
        if matches!(&self.credential, DeviceCredentialProfile::Passkey(passkey) if passkey.credential_fingerprint != credential_fingerprint)
        {
            return Err(DeviceAccessProfileRejection {
                profile: self,
                cause: DeviceAccessProfileTransitionError::CredentialChanged,
            });
        }
        if let DeviceCredentialProfile::Passkey(passkey) = &mut self.credential {
            passkey.nook_name = name;
            return Ok(self);
        }
        self.credential = DeviceCredentialProfile::Passkey(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            nook_name: name,
            ..PasskeyAccessProfile::default()
        });
        Ok(self)
    }

    #[allow(clippy::result_large_err)]
    pub fn set_passkey_provider_label(
        mut self,
        credential_fingerprint: &str,
        provider_label: String,
    ) -> Result<Self, DeviceAccessProfileRejection> {
        if matches!(&self.credential, DeviceCredentialProfile::Passkey(passkey) if passkey.credential_fingerprint != credential_fingerprint)
        {
            return Err(DeviceAccessProfileRejection {
                profile: self,
                cause: DeviceAccessProfileTransitionError::CredentialChanged,
            });
        }
        if let DeviceCredentialProfile::Passkey(passkey) = &mut self.credential {
            passkey.provider_label = provider_label;
            return Ok(self);
        }
        self.credential = DeviceCredentialProfile::Passkey(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            provider_label,
            ..PasskeyAccessProfile::default()
        });
        Ok(self)
    }

    #[must_use]
    pub fn record_passkey_created(
        mut self,
        credential_fingerprint: &str,
        nook_name: &str,
        observation: PasskeyBrowserObservation,
        now: IsoTimestamp,
        ceremony: PasskeyCreationCeremony,
    ) -> Self {
        self.credential = DeviceCredentialProfile::Passkey(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            nook_name: nook_name.trim().to_owned(),
            provider_label: String::new(),
            created_at: PasskeyCreatedAtEvidence::Known {
                timestamp: now.clone(),
            },
            last_used_at: match ceremony {
                PasskeyCreationCeremony::RegistrationOnly => {
                    PasskeyLastUsedAtEvidence::NotYetObserved
                }
                PasskeyCreationCeremony::RegistrationAndAssertion => {
                    PasskeyLastUsedAtEvidence::Known { timestamp: now }
                }
            },
            observation,
        });
        self
    }

    #[must_use]
    pub fn record_passkey_used(
        mut self,
        credential_fingerprint: &str,
        observation: PasskeyBrowserObservation,
        now: IsoTimestamp,
    ) -> Self {
        if let DeviceCredentialProfile::Passkey(mut passkey) = self.credential
            && passkey.credential_fingerprint == credential_fingerprint
        {
            passkey.last_used_at = PasskeyLastUsedAtEvidence::Known { timestamp: now };
            passkey.observation = passkey.observation.merge_usage(observation);
            self.credential = DeviceCredentialProfile::Passkey(passkey);
            return self;
        }
        self.credential = DeviceCredentialProfile::Passkey(PasskeyAccessProfile {
            credential_fingerprint: credential_fingerprint.to_owned(),
            last_used_at: PasskeyLastUsedAtEvidence::Known { timestamp: now },
            observation,
            ..PasskeyAccessProfile::default()
        });
        self
    }

    #[must_use]
    pub fn record_verified_vault_access(
        mut self,
        device_id: &DeviceId,
        store_id: &StoreId,
        now: IsoTimestamp,
    ) -> Self {
        self.verified_vaults
            .retain(|entry| &entry.device_id != device_id || &entry.store_id != store_id);
        self.verified_vaults.push(VerifiedVaultAccess {
            device_id: device_id.clone(),
            store_id: store_id.clone(),
            verified_at: now,
        });
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AppKey, DeviceIdentity, DeviceIdentityProtection, DeviceKeyProtectionSetup,
        IdentityDirectory, IdentityRecord, IdentitySelection, MemberLabelState,
        PasskeyDeviceProtectionMode, PasskeyProtectionInput, PasskeyRecordMetadata, StoreId,
        WrappedDeviceIdentity,
    };

    #[test]
    fn selected_vault_links_only_the_identity_that_owns_its_dek() -> anyhow::Result<()> {
        let personal_key = AppKey::generate()?;
        let work_key = AppKey::generate()?;
        let personal_store = StoreId::generate()?;
        let work_store = StoreId::generate()?;
        let mut personal = IdentityRecord::create_with_app_key(
            "Personal",
            &personal_key,
            MemberLabelState::Unnamed,
        )?;
        let mut work =
            IdentityRecord::create_with_app_key("Work", &work_key, MemberLabelState::Unnamed)?;
        let opened_identity = personal.generate_vault_dek(personal_store.clone())?;
        personal = opened_identity.identity;
        let opened_identity = work.generate_vault_dek(work_store)?;
        work = opened_identity.identity;
        let selected_work = work.identity_id.clone();
        let directory = IdentityDirectory::from_records(
            vec![work, personal],
            IdentitySelection::Selected(selected_work),
        )?;

        let linked = IdentityVaultLinks::new(&IdentityVaultLinksRequest {
            directory: &directory,
            store_id: &personal_store,
        })
        .collect();

        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].label, "Personal");
        Ok(())
    }

    #[test]
    fn selected_vault_links_are_empty_when_no_identity_owns_the_dek() -> anyhow::Result<()> {
        let personal_key = AppKey::generate()?;
        let personal_store = StoreId::generate()?;
        let unknown_store = StoreId::generate()?;
        let mut personal = IdentityRecord::create_with_app_key(
            "Personal",
            &personal_key,
            MemberLabelState::Unnamed,
        )?;
        let opened_identity = personal.generate_vault_dek(personal_store)?;
        personal = opened_identity.identity;
        let directory = IdentityDirectory::from_records(vec![personal], IdentitySelection::Empty)?;

        assert!(
            IdentityVaultLinks::new(&IdentityVaultLinksRequest {
                directory: &directory,
                store_id: &unknown_store,
            })
            .collect()
            .is_empty()
        );
        Ok(())
    }

    #[test]
    fn selected_vault_grants_a_member_with_both_dek_envelopes() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let store_id = StoreId::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let opened_identity = identity.generate_vault_dek(store_id.clone())?;
        identity = opened_identity.identity;

        assert_eq!(
            IdentityVaultAppGrant {
                identity: &identity,
                store_id: &store_id,
                app_id: app_key.app_id(),
            }
            .classify(),
            IdentityVaultAppGrantKind::Granted
        );
        Ok(())
    }

    #[test]
    fn selected_vault_does_not_grant_a_member_after_its_envelopes_are_revoked() -> anyhow::Result<()>
    {
        let app_key = AppKey::generate()?;
        let store_id = StoreId::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let opened_identity = identity.generate_vault_dek(store_id.clone())?;
        identity = opened_identity.identity;
        let vault = identity
            .vault_deks
            .iter_mut()
            .find(|vault| vault.store_id == store_id)
            .ok_or_else(|| anyhow::anyhow!("selected vault DEK is missing"))?;
        vault
            .secrets_envelopes
            .retain(|envelope| envelope.app_id != *app_key.app_id());
        vault
            .members_envelopes
            .retain(|envelope| envelope.app_id != *app_key.app_id());

        assert!(identity.has_app_id(app_key.app_id()));
        assert!(identity.owns_vault(&store_id));
        assert_eq!(
            IdentityVaultAppGrant {
                identity: &identity,
                store_id: &store_id,
                app_id: app_key.app_id(),
            }
            .classify(),
            IdentityVaultAppGrantKind::NotGranted
        );
        Ok(())
    }

    #[test]
    fn classifies_every_persisted_protection_shape() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let standard_credential = crate::WebAuthnCredentialId::try_from(vec![7; 32])?;
        let standard = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &standard_credential,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
        })?;
        let identity = DeviceIdentity::generate()?;
        let wrapped_credential = crate::WebAuthnCredentialId::try_from(vec![8; 32])?;
        let wrapped_output = crate::WebAuthnPrfOutput::try_from(vec![9; 32])?;
        let anti_hacker = DeviceIdentityProtection::new(&identity.secret_string()).with_passkey(
            &PasskeyProtectionInput {
                credential_id: &wrapped_credential,
                user_handle: setup.user_handle(),
                prf_input: setup.prf_input(),
                prf_output: &wrapped_output,
            },
        )?;
        assert_eq!(
            anti_hacker.device_mode()?,
            PasskeyDeviceProtectionMode::AntiHacker.as_str()
        );
        let pin = DeviceIdentityProtection::new(&identity.secret_string()).with_pin("six words")?;

        assert_eq!(
            DeviceAccessProtectionKind::Missing,
            DeviceAccessProtectionKind::Missing
        );
        assert_eq!(
            DeviceAccessProtectionKind::classify(&standard),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            DeviceAccessProtectionKind::classify(&anti_hacker),
            DeviceAccessProtectionKind::PasskeyAntiHacker
        );
        assert_eq!(
            DeviceAccessProtectionKind::classify(&pin),
            DeviceAccessProtectionKind::PinOrPassphrase
        );
        Ok(())
    }

    #[test]
    fn safe_identifiers_are_stable_and_do_not_embed_source_bytes() {
        let credential = PasskeyAccessProfile::credential_identifier(b"credential bytes");
        let user = PasskeyAccessProfile::user_handle_identifier(b"user handle");

        assert_eq!(
            credential,
            PasskeyAccessProfile::credential_identifier(b"credential bytes")
        );
        assert!(credential.starts_with("passkey_"));
        assert!(user.starts_with("user_"));
        assert!(!credential.contains("credential"));
        assert_eq!(credential.len(), "passkey_".len() + 16);
    }

    #[test]
    fn passkey_transports_use_stable_typed_serialization() -> anyhow::Result<()> {
        let transports = [PasskeyTransport::Hybrid, PasskeyTransport::Internal];
        let serialized = serde_json::to_string(&transports)?;
        assert_eq!(serialized, r#"["hybrid","internal"]"#);
        assert_eq!(
            serde_json::from_str::<Vec<PasskeyTransport>>(&serialized)?,
            transports
        );
        Ok(())
    }

    #[test]
    fn device_access_profile_version_is_typed_and_validated_during_decode() -> anyhow::Result<()> {
        let profile = DeviceAccessProfile::default();
        let serialized = serde_json::to_string(&profile)?;
        let decoded: DeviceAccessProfile = serde_json::from_str(&serialized)?;

        assert!(decoded.version.is_current());
        assert_eq!(
            DeviceAccessProfile::decode(&serialized),
            DeviceAccessProfileDecodeResult::Current(Box::new(profile))
        );
        assert_eq!(
            DeviceAccessProfile::decode(r#"{"version":0,"verifiedVaults":[]}"#),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            DeviceAccessProfile::decode(r#"{"version":999,"verifiedVaults":[]}"#),
            DeviceAccessProfileDecodeResult::FutureVersion
        );
        assert_eq!(
            DeviceAccessProfile::decode("not-json"),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            DeviceAccessProfile::decode(
                r#"{"version":1,"verifiedVaults":[{"storeId":"store-one","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            DeviceAccessProfile::decode(
                r#"{"version":1,"verifiedVaults":[{"deviceId":"","storeId":"store-one","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert!(matches!(
            DeviceAccessProfile::decode(
                r#"{"version":1,"verifiedVaults":[{"deviceId":"0123456789abcdef","storeId":"store_testtoken11","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::Current(_)
        ));
        assert_eq!(
            DeviceAccessProfile::decode(
                r#"{"version":1,"verifiedVaults":[{"deviceId":"0123456789abcdef","storeId":"store-one","verifiedAt":"2026-01-01T00:00:00.000Z"}]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        assert_eq!(
            DeviceAccessProfile::decode(
                r#"{"version":1,"passkey":{"providerLabel":"stale provider"},"verifiedVaults":[]}"#,
            ),
            DeviceAccessProfileDecodeResult::RecoverableDefault
        );
        Ok(())
    }

    #[test]
    fn passkey_name_transition_creates_metadata_for_an_empty_profile() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();

        profile = profile.set_passkey_name("passkey:first", "MacBook passkey".to_owned())?;

        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.credential_fingerprint, "passkey:first");
        assert_eq!(passkey.nook_name, "MacBook passkey");
        Ok(())
    }

    #[test]
    fn passkey_name_transition_preserves_matching_credential_evidence() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:first",
            "Old name",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationAndAssertion,
        );
        profile = profile.set_passkey_provider_label("passkey:first", "Proton Pass".to_owned())?;
        let evidence = profile.require_passkey()?.clone();

        profile = profile.set_passkey_name("passkey:first", "New name".to_owned())?;

        let renamed = profile.require_passkey()?;
        assert_eq!(renamed.nook_name, "New name");
        assert_eq!(renamed.provider_label, evidence.provider_label);
        assert_eq!(renamed.created_at, evidence.created_at);
        assert_eq!(renamed.last_used_at, evidence.last_used_at);
        assert_eq!(renamed.observation, evidence.observation);
        Ok(())
    }

    #[test]
    fn passkey_name_transition_rejects_a_changed_credential_without_mutation() {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:first",
            "Original name",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        let original = profile.clone();

        let result = profile.set_passkey_name("passkey:other", "Wrong key".to_owned());

        let Err(rejection) = result else {
            panic!("changed credential must reject");
        };
        assert_eq!(
            rejection.cause,
            DeviceAccessProfileTransitionError::CredentialChanged
        );
        assert_eq!(rejection.profile, original);
    }

    #[test]
    fn distinguishes_missing_locked_and_unlocked_identity_sessions() {
        assert_eq!(
            DeviceAccessIdentityObservation {
                session_unlocked: false.into(),
                session_device_id: "",
                persisted_identity: PersistedDeviceIdentityState::NotEstablished,
            }
            .identity_state(),
            DeviceAccessIdentityState::Missing
        );
        assert_eq!(
            DeviceAccessIdentityObservation {
                session_unlocked: false.into(),
                session_device_id: "",
                persisted_identity: PersistedDeviceIdentityState::Established,
            }
            .identity_state(),
            DeviceAccessIdentityState::Locked
        );
        assert_eq!(
            DeviceAccessIdentityObservation {
                session_unlocked: false.into(),
                session_device_id: "device-persisted",
                persisted_identity: PersistedDeviceIdentityState::Established,
            }
            .identity_state(),
            DeviceAccessIdentityState::Locked
        );
        assert_eq!(
            DeviceAccessIdentityObservation {
                session_unlocked: true.into(),
                session_device_id: "device-session",
                persisted_identity: PersistedDeviceIdentityState::Established,
            }
            .identity_state(),
            DeviceAccessIdentityState::Unlocked
        );
        assert_eq!(
            DeviceAccessIdentityObservation {
                session_unlocked: true.into(),
                session_device_id: "device-companion",
                persisted_identity: PersistedDeviceIdentityState::NotEstablished,
            }
            .identity_state(),
            DeviceAccessIdentityState::Unlocked
        );
        assert_eq!(
            DeviceAccessIdentityObservation {
                session_unlocked: false.into(),
                session_device_id: "device-companion",
                persisted_identity: PersistedDeviceIdentityState::NotEstablished,
            }
            .identity_state(),
            DeviceAccessIdentityState::Locked
        );
    }

    #[test]
    fn normalizes_user_provider_labels_without_inventing_provider_identity() {
        assert_eq!(
            PasskeyAccessProfile::normalize_provider_label("  Proton Pass  "),
            Ok("Proton Pass".to_owned())
        );
        assert_eq!(
            PasskeyAccessProfile::normalize_provider_label("   "),
            Ok(String::new())
        );
        assert_eq!(
            PasskeyAccessProfile::normalize_provider_label(&"x".repeat(81)),
            Err(DeviceAccessProviderLabelError::TooLong)
        );
        assert_eq!(
            PasskeyAccessProfile::normalize_provider_label("Apple\nPasswords"),
            Err(DeviceAccessProviderLabelError::ContainsControlCharacter)
        );
    }

    fn timestamp(value: &str) -> IsoTimestamp {
        IsoTimestamp::from_trusted(value.to_owned())
    }

    fn observation() -> PasskeyBrowserObservation {
        PasskeyBrowserObservation {
            attachment: PasskeyAuthenticatorAttachment::Platform,
            transports: vec![PasskeyTransport::Internal],
            backup_state: PasskeyBackupState::Eligible,
            aaguid: AuthenticatorGuidEvidence::Reported("aaguid-one".to_owned()),
            browser: PasskeyObservedBrowser::Safari,
            platform: PasskeyObservedPlatform::MacOs,
            legacy_client_environment: DiscardedClientEnvironment,
        }
    }

    #[test]
    fn credential_replacement_resets_provider_and_records_creation_evidence() -> anyhow::Result<()>
    {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:first",
            "First credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile = profile.set_passkey_provider_label("passkey:first", "Bitwarden".to_owned())?;

        profile = profile.record_passkey_created(
            "passkey:replacement",
            " Replacement credential ",
            observation(),
            timestamp("2026-02-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationAndAssertion,
        );

        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.nook_name, "Replacement credential");
        assert!(passkey.provider_label.is_empty());
        assert_eq!(
            passkey.last_used_at,
            PasskeyLastUsedAtEvidence::Known {
                timestamp: timestamp("2026-02-01T00:00:00.000Z")
            }
        );
        Ok(())
    }

    #[test]
    fn matching_usage_merges_new_observations_without_erasing_creation_evidence()
    -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:current",
            "Current credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );
        profile = profile.record_passkey_used(
            "passkey:current",
            PasskeyBrowserObservation {
                backup_state: PasskeyBackupState::BackedUp,
                browser: PasskeyObservedBrowser::Firefox,
                platform: PasskeyObservedPlatform::Linux,
                ..PasskeyBrowserObservation::default()
            },
            timestamp("2026-03-01T00:00:00.000Z"),
        );

        let passkey = profile.require_passkey()?;
        assert_eq!(passkey.observation.transports, [PasskeyTransport::Internal]);
        assert_eq!(
            passkey.observation.backup_state,
            PasskeyBackupState::BackedUp
        );
        assert_eq!(passkey.observation.browser, PasskeyObservedBrowser::Firefox);
        assert_eq!(
            passkey.created_at,
            PasskeyCreatedAtEvidence::Known {
                timestamp: timestamp("2026-01-01T00:00:00.000Z")
            }
        );
        Ok(())
    }

    #[test]
    fn provider_label_transition_rejects_a_replaced_credential() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        profile = profile.record_passkey_created(
            "passkey:current",
            "Current credential",
            observation(),
            timestamp("2026-01-01T00:00:00.000Z"),
            PasskeyCreationCeremony::RegistrationOnly,
        );

        let Err(rejection) =
            profile.set_passkey_provider_label("passkey:stale", "Bitwarden".to_owned())
        else {
            return Err(anyhow::anyhow!("stale credential must reject"));
        };
        assert_eq!(
            rejection.cause,
            DeviceAccessProfileTransitionError::CredentialChanged
        );
        let profile = rejection.profile;
        assert!(profile.require_passkey()?.provider_label.is_empty());
        Ok(())
    }

    #[test]
    fn verified_access_refreshes_only_the_matching_device_and_vault_pair() -> anyhow::Result<()> {
        let mut profile = DeviceAccessProfile::default();
        let device_a = DeviceId::parse("0123456789abcdef")?;
        let device_b = DeviceId::parse("fedcba9876543210")?;
        let store_id = StoreId::parse("store_testtoken11")?;
        profile = profile.record_verified_vault_access(
            &device_a,
            &store_id,
            timestamp("2026-01-01T00:00:00.000Z"),
        );
        profile = profile.record_verified_vault_access(
            &device_b,
            &store_id,
            timestamp("2026-02-01T00:00:00.000Z"),
        );
        profile = profile.record_verified_vault_access(
            &device_a,
            &store_id,
            timestamp("2026-03-01T00:00:00.000Z"),
        );

        assert_eq!(profile.verified_vaults.len(), 2);
        assert_eq!(
            profile.verified_vaults[1].verified_at,
            timestamp("2026-03-01T00:00:00.000Z")
        );
        Ok(())
    }
}
