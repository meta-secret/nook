use crate::NookError;
use nook_core::SessionError;

impl From<nook_core::VaultError> for NookError {
    fn from(err: nook_core::VaultError) -> Self {
        use nook_core::VaultError;
        match err {
            VaultError::ExtensionIdentityHandoff(e) => NookError::Encryption(e.to_string()),
            VaultError::Validation(e) => NookError::Database(e.to_string()),
            VaultError::VaultFormat(e) => NookError::Decryption(e.to_string()),
            VaultError::VaultCrypto(e) => NookError::Encryption(e.to_string()),
            VaultError::MultiDevice(e) => NookError::Encryption(e.to_string()),
            VaultError::Password(e) => NookError::Encryption(e.to_string()),
            VaultError::Age(e) => NookError::Encryption(e.to_string()),
            VaultError::Database(e) => NookError::Database(e.to_string()),
            VaultError::Session(SessionError::EmptyProjectionCache) => {
                NookError::Decryption(SessionError::EmptyProjectionCache.to_string())
            }
            VaultError::Session(e) => NookError::Database(e.to_string()),
            VaultError::VaultSync(e) => NookError::Database(e.to_string()),
            VaultError::VaultEpoch(e) => NookError::Database(e.to_string()),
            VaultError::SecretPayload(e) => NookError::Database(e.to_string()),
            VaultError::Event(event) => event.into(),
            VaultError::Enrollment(e) => NookError::Encryption(e.to_string()),
        }
    }
}

impl From<nook_core::EventError> for NookError {
    fn from(event: nook_core::EventError) -> Self {
        use nook_core::EventError;
        match event {
            EventError::SigningSeedGeneration(_)
            | EventError::SigningSeedWrongLength
            | EventError::SignatureVerificationFailed
            | EventError::SignatureInvalidHex(_)
            | EventError::SignatureMissingPrefix { .. }
            | EventError::SignatureWrongLength
            | EventError::AuthKeyId(_) => NookError::Encryption(event.to_string()),
            _ => NookError::Database(event.to_string()),
        }
    }
}

impl From<nook_core::ValidationError> for NookError {
    fn from(err: nook_core::ValidationError) -> Self {
        use nook_core::ValidationError;
        match err {
            ValidationError::GithubPatEmpty
            | ValidationError::GithubRepoLength
            | ValidationError::GithubRepoInvalid
            | ValidationError::GithubRepoChars => NookError::GitHub(err.to_string()),

            ValidationError::DriveFileNameLength
            | ValidationError::DriveFileNameInvalid
            | ValidationError::DriveFileNameChars => NookError::Drive(err.to_string()),

            ValidationError::OauthAccessTokenEmpty
            | ValidationError::SharedJoinerIdentityRequired
            | ValidationError::SharedJoinerIdentityInvalid
            | ValidationError::SharedStorageTargetRequired
            | ValidationError::SharedStorageTargetInvalid
            | ValidationError::UnknownStorageMode { .. }
            | ValidationError::UnknownDeviceMode { .. }
            | ValidationError::UnknownVaultType { .. }
            | ValidationError::UnknownVaultApplication { .. }
            | ValidationError::VaultApplicationTypeMismatch { .. }
            | ValidationError::SentinelExtensionForbidden
            | ValidationError::ExtensionApprovalApplicationForbidden { .. }
            | ValidationError::UnknownReplicationType { .. }
            | ValidationError::UnsupportedProviderReplication { .. }
            | ValidationError::SimpleVaultHasSentinelPolicy
            | ValidationError::InvalidSentinelPolicy
            | ValidationError::SentinelVaultHasFullKeyEnvelopes
            | ValidationError::SimpleVaultHasSentinelShares
            | ValidationError::InvalidSentinelShareSet
            | ValidationError::SecretDataRequired
            | ValidationError::SecretIdRequired
            | ValidationError::SecretIdInvalid
            | ValidationError::SecretIdReserved
            | ValidationError::StoreIdInvalid
            | ValidationError::StoreIdReserved
            | ValidationError::AuthKeyIdInvalid
            | ValidationError::DeviceIdInvalid
            | ValidationError::Bip39Empty
            | ValidationError::Bip39Invalid
            | ValidationError::AuthenticatorIssuerRequired
            | ValidationError::AuthenticatorSecretInvalid
            | ValidationError::AuthenticatorIssuerCatalogInvalid
            | ValidationError::AuthenticatorDigitsInvalid
            | ValidationError::AuthenticatorPeriodInvalid
            | ValidationError::AuthenticatorUriInvalid
            | ValidationError::AuthenticatorBackupCodesInvalid
            | ValidationError::CreditCardTitleRequired
            | ValidationError::CreditCardNumberInvalid
            | ValidationError::CreditCardExpirationInvalid
            | ValidationError::CreditCardCvvInvalid
            | ValidationError::SymmetricKeyInvalid
            | ValidationError::SecretFingerprintKeyInvalid
            | ValidationError::AgeArmoredInvalid
            | ValidationError::DevicePublicKeyInvalid
            | ValidationError::DeviceIdentitySecretInvalid
            | ValidationError::Sha256HexInvalid
            | ValidationError::IdentityVaultEventIdInvalid
            | ValidationError::DeviceSigningPublicKeyInvalid
            | ValidationError::IsoTimestampInvalid
            | ValidationError::PasswordEntryIdInvalid
            | ValidationError::SigningSeedInvalid => NookError::Database(err.to_string()),
        }
    }
}

impl From<nook_core::MultiDeviceError> for NookError {
    fn from(err: nook_core::MultiDeviceError) -> Self {
        NookError::Encryption(err.to_string())
    }
}

impl From<nook_core::VaultFormatError> for NookError {
    fn from(err: nook_core::VaultFormatError) -> Self {
        NookError::Decryption(err.to_string())
    }
}

impl From<nook_core::VaultCryptoError> for NookError {
    fn from(err: nook_core::VaultCryptoError) -> Self {
        NookError::Encryption(err.to_string())
    }
}

impl From<nook_core::DatabaseError> for NookError {
    fn from(err: nook_core::DatabaseError) -> Self {
        NookError::Database(err.to_string())
    }
}

impl From<nook_core::SecretPayloadError> for NookError {
    fn from(err: nook_core::SecretPayloadError) -> Self {
        NookError::Database(err.to_string())
    }
}

impl From<nook_core::SessionError> for NookError {
    fn from(err: nook_core::SessionError) -> Self {
        NookError::Database(err.to_string())
    }
}

impl From<nook_core::VaultSyncError> for NookError {
    fn from(err: nook_core::VaultSyncError) -> Self {
        NookError::Database(err.to_string())
    }
}

impl From<nook_core::PasswordError> for NookError {
    fn from(err: nook_core::PasswordError) -> Self {
        NookError::Encryption(err.to_string())
    }
}

impl From<nook_core::VaultEpochError> for NookError {
    fn from(err: nook_core::VaultEpochError) -> Self {
        NookError::Database(err.to_string())
    }
}

impl From<nook_core::DeviceKeyProtectionError> for NookError {
    fn from(err: nook_core::DeviceKeyProtectionError) -> Self {
        NookError::Decryption(err.to_string())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        DatabaseError, DeviceKeyProtectionError, EventError, MultiDeviceError, PasswordError,
        SecretId, SecretPayloadError, SessionError, ValidationError, VaultCryptoError,
        VaultEpochError, VaultFormatError, VaultSyncError,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn error_adapters_project_boundary_categories_in_wasm() {
        let secret_id = SecretId::from_vault_record("secret");
        let mapped = NookError::from(ValidationError::GithubPatEmpty);
        assert!(matches!(mapped, NookError::GitHub(_)));
        let mapped = NookError::from(nook_core::VaultError::Validation(
            ValidationError::GithubPatEmpty,
        ));
        assert!(matches!(mapped, NookError::Database(_)));
        let mapped = NookError::from(nook_core::VaultError::Validation(
            ValidationError::OauthAccessTokenEmpty,
        ));
        assert!(matches!(mapped, NookError::Database(_)));
        let mapped = NookError::from(nook_core::VaultError::Event(
            EventError::SigningSeedGeneration("seed".into()),
        ));
        assert!(matches!(mapped, NookError::Encryption(_)));
        let mapped = NookError::from(nook_core::VaultError::Event(EventError::ParseStoredEvent(
            "event".into(),
        )));
        assert!(matches!(mapped, NookError::Database(_)));
        let _ = NookError::from(nook_core::VaultError::Enrollment(
            nook_core::EnrollmentError::InvalidCode,
        ));
        let _ = NookError::from(nook_core::VaultError::VaultCrypto(
            VaultCryptoError::EncryptSetup("setup".into()),
        ));
        let _ = NookError::from(nook_core::VaultError::VaultFormat(
            VaultFormatError::UnrecognizedFormat {
                first_line: "bad".into(),
            },
        ));
        let _ = NookError::from(nook_core::VaultError::SecretPayload(
            SecretPayloadError::UnknownSecretType {
                value: "bad".into(),
            },
        ));
        let _ = NookError::from(nook_core::VaultError::Password(
            PasswordError::NoCharacterSet,
        ));
        let _ = NookError::from(nook_core::VaultError::MultiDevice(
            MultiDeviceError::IdentityLabelEmpty,
        ));
        let _ = NookError::from(nook_core::VaultError::Database(
            DatabaseError::MissingSecretType {
                key: secret_id.clone(),
            },
        ));
        let _ = NookError::from(nook_core::VaultError::Session(
            SessionError::EmptyProjectionCache,
        ));
        let _ = NookError::from(nook_core::VaultError::VaultSync(
            VaultSyncError::MissingStoreId,
        ));
        let _ = NookError::from(nook_core::VaultError::VaultEpoch(
            VaultEpochError::MissingSecretType {
                key: "secret".into(),
            },
        ));
        assert!(matches!(
            NookError::from(nook_core::MultiDeviceError::IdentityLabelEmpty),
            NookError::Encryption(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::VaultFormatError::YamlMissingSections),
            NookError::Decryption(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::VaultCryptoError::Encrypt("x".into())),
            NookError::Encryption(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::SecretPayloadError::UnknownSecretType { value: "x".into() }),
            NookError::Database(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::SessionError::ReplacementIdUnchanged),
            NookError::Database(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::VaultSyncError::RemoteChangedDuringWrite),
            NookError::Database(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::PasswordError::NoCharacterSet),
            NookError::Encryption(_)
        ));
        assert!(matches!(
            NookError::from(nook_core::VaultEpochError::MissingSecretType { key: "x".into() }),
            NookError::Database(_)
        ));
        assert!(matches!(
            NookError::from(DeviceKeyProtectionError::CredentialIdEmpty),
            NookError::Decryption(_)
        ));
    }
}
