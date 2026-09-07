#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    DEVICE_ACCESS_PROFILE_VERSION, DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS,
    DeviceAccessIdentityState, DeviceAccessProfile, DeviceAccessProfileDecodeResult,
    DeviceAccessProfileVersionEnvelope, DeviceAccessProtectionKind, DeviceAccessProviderLabelError,
    PasskeyAccessProfile,
};
use crate::{AppId, IdentityDirectory, IdentityRecord, StoreId, WrappedDeviceIdentity};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityVaultAppGrantKind {
    NotLinked,
    NotGranted,
    Granted,
}

/// Inputs for selecting identities linked to one vault.
pub struct IdentityVaultLinksRequest<'a> {
    pub directory: &'a IdentityDirectory,
    pub store_id: &'a StoreId,
}

/// Owns the identity-directory lookup for a selected vault.
pub struct IdentityVaultLinks<'a> {
    directory: &'a IdentityDirectory,
    store_id: &'a StoreId,
}

impl<'a> IdentityVaultLinks<'a> {
    #[must_use]
    pub fn new(request: &IdentityVaultLinksRequest<'a>) -> Self {
        Self {
            directory: request.directory,
            store_id: request.store_id,
        }
    }

    /// Return identities whose typed DEK grants link them to the selected vault.
    #[must_use]
    pub fn collect(&self) -> Vec<&'a IdentityRecord> {
        self.directory
            .identities()
            .iter()
            .filter(|identity| identity.owns_vault(self.store_id))
            .collect()
    }
}

/// Owns one identity/app/vault grant classification query.
pub struct IdentityVaultAppGrant<'a> {
    pub identity: &'a IdentityRecord,
    pub store_id: &'a StoreId,
    pub app_id: &'a AppId,
}

impl IdentityVaultAppGrant<'_> {
    #[must_use]
    pub fn classify(&self) -> IdentityVaultAppGrantKind {
        let Some(vault) = self.identity.vault_dek(self.store_id) else {
            return IdentityVaultAppGrantKind::NotLinked;
        };
        if !self.identity.has_app_id(self.app_id) {
            return IdentityVaultAppGrantKind::NotGranted;
        }
        let grants_secrets = vault
            .secrets_envelopes
            .iter()
            .any(|envelope| envelope.app_id == *self.app_id);
        let grants_members = vault
            .members_envelopes
            .iter()
            .any(|envelope| envelope.app_id == *self.app_id);
        if grants_secrets && grants_members {
            IdentityVaultAppGrantKind::Granted
        } else {
            IdentityVaultAppGrantKind::NotGranted
        }
    }
}

impl DeviceAccessProfile {
    /// Decode a persisted device-access profile at its schema boundary.
    #[must_use]
    pub fn decode(raw: &str) -> DeviceAccessProfileDecodeResult {
        let Ok(envelope) = serde_json::from_str::<DeviceAccessProfileVersionEnvelope>(raw) else {
            return DeviceAccessProfileDecodeResult::RecoverableDefault;
        };
        if envelope.version.is_future() {
            return DeviceAccessProfileDecodeResult::FutureVersion;
        }
        if !envelope.version.is_current() {
            return DeviceAccessProfileDecodeResult::RecoverableDefault;
        }
        match serde_json::from_str::<DeviceAccessProfile>(raw) {
            Ok(profile)
                if profile
                    .passkey
                    .as_ref()
                    .is_none_or(|passkey| !passkey.credential_fingerprint.trim().is_empty()) =>
            {
                DeviceAccessProfileDecodeResult::Current(Box::new(profile))
            }
            Ok(_) | Err(_) => DeviceAccessProfileDecodeResult::RecoverableDefault,
        }
    }
}

impl DeviceAccessProtectionKind {
    #[must_use]
    pub fn classify(record: Option<&WrappedDeviceIdentity>) -> Self {
        match record {
            None => Self::Missing,
            Some(WrappedDeviceIdentity::PasskeyDerived(_)) => Self::PasskeyStandard,
            Some(WrappedDeviceIdentity::PasskeyWrappedLocal(_)) => Self::PasskeyAntiHacker,
            Some(WrappedDeviceIdentity::Pin(_)) => Self::PinOrPassphrase,
        }
    }
}

/// Captures the browser/session observations used to classify device identity state.
pub struct DeviceAccessIdentityObservation<'a> {
    pub session_unlocked: bool,
    pub session_device_id: &'a str,
    pub persisted_device_id: Option<&'a str>,
}

impl DeviceAccessIdentityState {
    #[must_use]
    pub fn classify(observation: &DeviceAccessIdentityObservation<'_>) -> Self {
        if observation.session_unlocked {
            Self::Unlocked
        } else if !observation.session_device_id.trim().is_empty()
            || observation.persisted_device_id.is_some()
        {
            Self::Locked
        } else {
            Self::Missing
        }
    }
}

impl PasskeyAccessProfile {
    /// Stable, non-secret correlation id for a Nook-managed WebAuthn credential.
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: hashes the browser WebAuthn credential-id ArrayBuffer bytes"
        )
    )]
    pub fn credential_identifier(credential_id: &[u8]) -> String {
        Self::short_identifier("passkey", credential_id)
    }

    /// Stable, non-secret correlation id for the RP-scoped WebAuthn user handle.
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: hashes the browser WebAuthn user-handle ArrayBuffer bytes"
        )
    )]
    pub fn user_handle_identifier(user_handle: &[u8]) -> String {
        Self::short_identifier("user", user_handle)
    }

    #[must_use]
    pub fn normalize_provider_label(value: &str) -> Result<String, DeviceAccessProviderLabelError> {
        let value = value.trim();
        if value.chars().count() > DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS {
            return Err(DeviceAccessProviderLabelError::TooLong);
        }
        if value.chars().any(char::is_control) {
            return Err(DeviceAccessProviderLabelError::ContainsControlCharacter);
        }
        Ok(value.to_owned())
    }

    #[must_use]
    pub fn normalize_name(value: &str) -> Result<String, DeviceAccessProviderLabelError> {
        Self::normalize_provider_label(value)
    }

    fn short_identifier(prefix: &str, bytes: &[u8]) -> String {
        let digest = Sha256::digest(bytes);
        format!("{prefix}_{}", hex::encode(&digest[..8]))
    }
}
