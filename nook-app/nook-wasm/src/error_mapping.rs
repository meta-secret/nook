use crate::NookError;

impl From<nook_core::VaultError> for NookError {
    fn from(err: nook_core::VaultError) -> Self {
        use nook_core::VaultError;
        match err {
            VaultError::Validation(e) => NookError::Database(e.to_string()),
            VaultError::VaultFormat(e) => NookError::Decryption(e.to_string()),
            VaultError::VaultCrypto(e) => NookError::Encryption(e.to_string()),
            VaultError::MultiDevice(e) => NookError::Encryption(e.to_string()),
            VaultError::Password(e) => NookError::Encryption(e.to_string()),
            VaultError::Age(e) => NookError::Encryption(e.to_string()),
            VaultError::Database(e) => NookError::Database(e.to_string()),
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
            EventError::EmptyProjectionCache => NookError::Decryption(event.to_string()),
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
            | ValidationError::UnknownStorageMode { .. }
            | ValidationError::UnknownDeviceMode { .. }
            | ValidationError::UnknownVaultType { .. }
            | ValidationError::UnknownReplicationType { .. }
            | ValidationError::UnsupportedProviderReplication { .. }
            | ValidationError::SimpleVaultHasNexusPolicy
            | ValidationError::InvalidNexusPolicy
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
            | ValidationError::SymmetricKeyInvalid
            | ValidationError::AgeArmoredInvalid
            | ValidationError::DevicePublicKeyInvalid
            | ValidationError::DeviceIdentitySecretInvalid
            | ValidationError::Sha256HexInvalid
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
