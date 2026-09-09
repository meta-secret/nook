//! Device-key sealing for sync-provider credential fields inside a persisted
//! snapshot (`githubPat`, OAuth `accessToken` / `refreshToken`).

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, DeviceIdentity, DevicePublicKey, Sha256Hex,
    StoredGithubPat, StoredOAuthAccessCredential, StoredOAuthRefreshCredential,
    errors::{MultiDeviceError, MultiDeviceResult},
};
use zeroize::Zeroizing;

/// Marker substring present in every age-armored credential ciphertext.
pub const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";

/// Seal every credential field in `snapshot` with `identity` (in place).
impl AuthProvidersSnapshotData {
    pub fn seal_credentials(&mut self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        for provider in &mut self.providers {
            if let StoredGithubPat::Token(token) = &mut provider.github_pat {
                ProviderCredentialField { value: token }.seal(identity)?;
            }
            if let Some(oauth) = provider.oauth_file.as_mut() {
                if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                    ProviderCredentialField { value: token }.seal(identity)?;
                }
                if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                    ProviderCredentialField { value: token }.seal(identity)?;
                }
            }
        }
        Ok(())
    }
}

/// Seal every plaintext credential field in `snapshot` for another device's
/// public key (in place), without requiring the recipient device's private key.
impl AuthProvidersSnapshotData {
    pub fn seal_credentials_for(&mut self, public_key: &DevicePublicKey) -> MultiDeviceResult<()> {
        for provider in &mut self.providers {
            if let StoredGithubPat::Token(token) = &mut provider.github_pat {
                ProviderCredentialField { value: token }.seal_for(public_key)?;
            }
            if let Some(oauth) = provider.oauth_file.as_mut() {
                if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                    ProviderCredentialField { value: token }.seal_for(public_key)?;
                }
                if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                    ProviderCredentialField { value: token }.seal_for(public_key)?;
                }
            }
        }
        Ok(())
    }
}

/// Unseal credential fields in `snapshot` (in place).
///
/// Plaintext stored credentials are rejected; only the current encrypted
/// storage schema is accepted.
impl AuthProvidersSnapshotData {
    pub fn open_credentials(&mut self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        let mut opened = self.clone();
        for provider in &mut opened.providers {
            if let StoredGithubPat::Token(token) = &mut provider.github_pat {
                ProviderCredentialField { value: token }.open(identity)?;
            }
            if let Some(oauth) = provider.oauth_file.as_mut() {
                if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                    ProviderCredentialField { value: token }.open(identity)?;
                }
                if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                    ProviderCredentialField { value: token }.open(identity)?;
                }
            }
        }
        *self = opened;
        Ok(())
    }

    /// Authenticate every nonempty credential for an exact recipient without
    /// retaining the decrypted plaintext.
    pub fn authenticate_credentials_for(&self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        for provider in &self.providers {
            if let StoredGithubPat::Token(token) = &provider.github_pat {
                ProviderCredentialField::authenticate(token, identity)?;
            }
            if let Some(oauth) = provider.oauth_file.as_ref() {
                if let StoredOAuthAccessCredential::AccessToken(token) = &oauth.access_token {
                    ProviderCredentialField::authenticate(token, identity)?;
                }
                if let StoredOAuthRefreshCredential::Token(token) = &oauth.refresh_token {
                    ProviderCredentialField::authenticate(token, identity)?;
                }
            }
        }
        Ok(())
    }

    /// Hash the canonical typed provider snapshot, including encrypted fields.
    pub fn companion_pairing_manifest_digest(&self) -> serde_json::Result<Sha256Hex> {
        Ok(Sha256Hex::from_bytes(&serde_json::to_vec(self)?))
    }
}

/// Observe whether every field is empty or contains the armor marker.
/// This does not validate the armored bytes, recipient, or authentication.
///
/// Used by extension pairing to persist website-sealed provider grants without
/// requiring an unlocked device session in the offscreen document.
impl AuthProvidersSnapshotData {
    #[must_use]
    pub fn credential_storage_admission(&self) -> ProviderCredentialStorageAdmission {
        let compatible = self.providers.iter().all(|provider| {
            provider
                .github_pat
                .as_deref()
                .is_none_or(ProviderCredentialField::allows_storage)
                && provider.oauth_file.as_ref().is_none_or(|oauth| {
                    oauth
                        .access_token
                        .as_deref()
                        .is_none_or(ProviderCredentialField::allows_storage)
                        && oauth
                            .refresh_token
                            .as_deref()
                            .is_none_or(ProviderCredentialField::allows_storage)
                })
        });
        if compatible {
            ProviderCredentialStorageAdmission::MarkerCompatible
        } else {
            ProviderCredentialStorageAdmission::PlaintextPresent
        }
    }
}

/// Marker compatibility is a storage admission check, not ciphertext validity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCredentialStorageAdmission {
    MarkerCompatible,
    PlaintextPresent,
}

/// A lexical credential observation, not ciphertext validation or authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCredentialEncoding {
    Empty,
    ArmorMarked,
    Plaintext,
}
impl ProviderCredentialEncoding {
    #[must_use]
    pub fn observe(value: &str) -> Self {
        if value.is_empty() {
            Self::Empty
        } else if value.contains(AGE_ARMOR_MARKER) {
            Self::ArmorMarked
        } else {
            Self::Plaintext
        }
    }
}
struct ProviderCredentialField<'a> {
    value: &'a mut String,
}
impl ProviderCredentialField<'_> {
    fn authenticate(value: &str, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        if !value.is_empty() {
            let ciphertext = AgeArmoredCiphertext::parse(value)?;
            let _plaintext = Zeroizing::new(identity.open_utf8(&ciphertext)?);
        }
        Ok(())
    }

    fn has_armor_marker(value: &str) -> bool {
        ProviderCredentialEncoding::observe(value) == ProviderCredentialEncoding::ArmorMarked
    }
    fn allows_storage(value: &str) -> bool {
        ProviderCredentialEncoding::observe(value) != ProviderCredentialEncoding::Plaintext
    }
    fn seal(&mut self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        if !self.value.is_empty() && !ProviderCredentialField::has_armor_marker(self.value) {
            *self.value = identity.seal_utf8(self.value)?.into_inner();
        }
        Ok(())
    }
    fn seal_for(&mut self, public_key: &DevicePublicKey) -> MultiDeviceResult<()> {
        if !self.value.is_empty() && !ProviderCredentialField::has_armor_marker(self.value) {
            *self.value = public_key.seal_bytes(self.value.as_bytes())?.into_inner();
        }
        Ok(())
    }
    fn open(&mut self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        if self.value.is_empty() {
            return Ok(());
        }
        if ProviderCredentialField::has_armor_marker(self.value) {
            *self.value = identity.open_utf8(&AgeArmoredCiphertext::parse(self.value)?)?;
        } else {
            return Err(MultiDeviceError::UnsealedProviderCredential);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ActiveVaultScope, GoogleDriveMode, ProviderSyncCheckpoint, ProviderVaultScope,
        StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder, StoredICloudShareTarget,
        StoredLocalFolderConfiguration, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
        StoredOAuthFileConfiguration, StoredOAuthRefreshCredential, StoredOAuthRemoteFileId,
        StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
    };

    use std::io;

    use super::{
        AGE_ARMOR_MARKER, AuthProvidersSnapshotData, MultiDeviceError, MultiDeviceResult,
        ProviderCredentialEncoding, ProviderCredentialField, ProviderCredentialStorageAdmission,
    };
    use crate::{
        DeviceIdentity, ICloudMode, OAuthFileConfigData, OauthFilePreset, StorageProviderData,
        StorageProviderType,
    };

    enum ExpectedCredentialFailure {
        Unsealed,
        AnyError,
    }
    impl ExpectedCredentialFailure {
        fn verify(self, result: MultiDeviceResult<()>) -> anyhow::Result<()> {
            match (self, result) {
                (_, Ok(())) => anyhow::bail!("credential opening unexpectedly succeeded"),
                (Self::Unsealed, Err(MultiDeviceError::UnsealedProviderCredential))
                | (Self::AnyError, Err(_)) => Ok(()),
                (Self::Unsealed, Err(error)) => Err(error.into()),
            }
        }
    }

    struct OAuthCredentialFixture<'a> {
        access: &'a str,
        refresh: Option<&'a str>,
    }

    impl AuthProvidersSnapshotData {
        fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
            AuthProvidersSnapshotData {
                providers: vec![StorageProviderData::github(
                    "gh-1",
                    "GitHub",
                    pat,
                    "nook",
                    "2026-06-24T00:00:00.000Z",
                )],
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
        }

        fn oauth_snapshot(credential: &OAuthCredentialFixture<'_>) -> AuthProvidersSnapshotData {
            let OAuthCredentialFixture { access, refresh } = *credential;
            AuthProvidersSnapshotData {
                providers: vec![StorageProviderData {
                    id: "gd-1".to_owned(),
                    provider_type: StorageProviderType::OauthFile,
                    label: "Google Drive".to_owned(),
                    github_pat: StoredGithubPat::Missing,
                    github_repo: StoredGithubRepository::DefaultRepository,
                    oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                        preset: OauthFilePreset::GoogleDrive,
                        access_token: StoredOAuthAccessCredential::AccessToken(access.to_owned()),
                        refresh_token: StoredOAuthRefreshCredential::from_option(
                            refresh.map(str::to_owned),
                        ),
                        expires_at: StoredOAuthTokenExpiry::Unknown,
                        file_id: StoredOAuthRemoteFileId::Unresolved,
                        folder_id: StoredGoogleDriveFolder::Root,
                        drive_mode: GoogleDriveMode::Private,
                        icloud_mode: ICloudMode::Private,
                        icloud_share_target: StoredICloudShareTarget::Personal,
                        file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
                        account_email: StoredOAuthAccountIdentity::Email(
                            "me@example.com".to_owned(),
                        ),
                    }),
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                }],
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
        }
    }
    #[test]
    fn seal_and_open_github_pat_round_trips() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11AAAAbbbbCCCC";
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot(pat);
        snapshot.seal_credentials(&identity)?;
        let StoredGithubPat::Token(stored) = &snapshot.providers[0].github_pat else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        opened.open_credentials(&identity)?;
        assert_eq!(
            opened.providers[0].github_pat,
            StoredGithubPat::Token(pat.to_owned())
        );
        Ok(())
    }

    #[test]
    fn seal_and_open_oauth_tokens_round_trips() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let access = "ya29.oauth-access-token";
        let refresh = "1//refresh-token-secret";
        let mut snapshot = AuthProvidersSnapshotData::oauth_snapshot(&OAuthCredentialFixture {
            access,
            refresh: Some(refresh),
        });
        snapshot.seal_credentials(&identity)?;
        let oauth = snapshot.providers[0]
            .oauth_file
            .as_ref()
            .ok_or_else(|| io::Error::other("test as_ref value must exist"))?;
        let StoredOAuthAccessCredential::AccessToken(stored_access) = &oauth.access_token else {
            return Err(io::Error::other("sealed access token must be present").into());
        };
        let StoredOAuthRefreshCredential::Token(stored_refresh) = &oauth.refresh_token else {
            return Err(io::Error::other("sealed refresh token must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored_access));
        assert!(ProviderCredentialField::has_armor_marker(stored_refresh));
        assert!(!stored_access.contains(access));
        assert!(!stored_refresh.contains(refresh));

        let mut opened = snapshot;
        opened.open_credentials(&identity)?;
        let opened_oauth = opened.providers[0]
            .oauth_file
            .as_ref()
            .ok_or_else(|| io::Error::other("test as_ref value must exist"))?;
        assert_eq!(
            opened_oauth.access_token,
            StoredOAuthAccessCredential::AccessToken(access.to_owned())
        );
        assert_eq!(
            opened_oauth.refresh_token,
            StoredOAuthRefreshCredential::Token(refresh.to_owned())
        );
        Ok(())
    }

    #[test]
    fn open_rejects_plaintext_credentials() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11LEGACY";
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot(pat);
        ExpectedCredentialFailure::Unsealed.verify(snapshot.open_credentials(&identity))?;
        Ok(())
    }

    #[test]
    fn seal_is_idempotent_for_already_sealed_fields() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11AAAA");
        snapshot.seal_credentials(&identity)?;
        let sealed_once = snapshot.providers[0].github_pat.clone();
        snapshot.seal_credentials(&identity)?;
        assert_eq!(snapshot.providers[0].github_pat, sealed_once);
        Ok(())
    }

    #[test]
    fn sealed_credentials_fail_on_wrong_device() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11SECRET");
        snapshot.seal_credentials(&owner)?;
        let sealed = snapshot.clone();
        ExpectedCredentialFailure::AnyError.verify(snapshot.open_credentials(&other))?;
        assert_eq!(snapshot, sealed);
        Ok(())
    }

    #[test]
    fn open_failure_does_not_partially_decrypt_snapshot() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::oauth_snapshot(&OAuthCredentialFixture {
            access: "ya29.valid-access",
            refresh: Some("invalid plaintext refresh"),
        });
        let oauth = snapshot.providers[0]
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("test as_mut value must exist"))?;
        let StoredOAuthAccessCredential::AccessToken(access_token) = &mut oauth.access_token else {
            return Err(io::Error::other("plaintext access token must be present").into());
        };
        ProviderCredentialField {
            value: access_token,
        }
        .seal(&identity)?;
        let sealed = snapshot.clone();

        ExpectedCredentialFailure::Unsealed.verify(snapshot.open_credentials(&identity))?;
        assert_eq!(snapshot, sealed);
        Ok(())
    }

    #[test]
    fn seal_for_public_key_opens_on_recipient_device() -> anyhow::Result<()> {
        let extension = DeviceIdentity::generate()?;
        let pat = "github_pat_11EXTENSIONgrant";
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot(pat);
        snapshot.seal_credentials_for(&extension.public_key())?;
        let StoredGithubPat::Token(stored) = &snapshot.providers[0].github_pat else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        opened.open_credentials(&extension)?;
        assert_eq!(
            opened.providers[0].github_pat,
            StoredGithubPat::Token(pat.to_owned())
        );
        Ok(())
    }

    #[test]
    fn pairing_manifest_authenticates_recipient_and_snapshot() -> anyhow::Result<()> {
        let recipient = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11PAIRING");
        snapshot.providers.extend(
            AuthProvidersSnapshotData::oauth_snapshot(&OAuthCredentialFixture {
                access: "oauth-access-pairing",
                refresh: Some("oauth-refresh-pairing"),
            })
            .providers,
        );
        snapshot.seal_credentials_for(&recipient.public_key())?;
        let digest = snapshot.companion_pairing_manifest_digest()?;

        snapshot.authenticate_credentials_for(&recipient)?;
        ExpectedCredentialFailure::AnyError
            .verify(snapshot.authenticate_credentials_for(&other))?;
        snapshot.providers[0].label = "Substituted".to_owned();
        assert_ne!(snapshot.companion_pairing_manifest_digest()?, digest);
        Ok(())
    }

    #[test]
    fn presealed_check_accepts_sealed_or_empty_credentials() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11PRESEAL");
        assert_ne!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        snapshot.seal_credentials(&identity)?;
        assert_eq!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        assert_eq!(
            (AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
            })
            .credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        Ok(())
    }

    #[test]
    fn marker_observation_does_not_validate_ciphertext() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let malformed = format!("prefix {AGE_ARMOR_MARKER} malformed suffix");
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot(&malformed);
        assert_eq!(
            ProviderCredentialEncoding::observe(&malformed),
            ProviderCredentialEncoding::ArmorMarked
        );
        assert_eq!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        let original = snapshot.clone();
        snapshot.seal_credentials(&identity)?;
        assert_eq!(snapshot, original);
        snapshot.seal_credentials_for(&identity.public_key())?;
        assert_eq!(snapshot, original);
        ExpectedCredentialFailure::AnyError.verify(snapshot.open_credentials(&identity))?;
        assert_eq!(snapshot, original);
        Ok(())
    }

    #[test]
    fn credential_observation_preserves_empty_and_case_distinctions() {
        for (value, expected) in [
            ("", ProviderCredentialEncoding::Empty),
            (" ", ProviderCredentialEncoding::Plaintext),
            (
                "begin age encrypted file",
                ProviderCredentialEncoding::Plaintext,
            ),
            (
                "xBEGIN AGE ENCRYPTED FILEy",
                ProviderCredentialEncoding::ArmorMarked,
            ),
        ] {
            assert_eq!(ProviderCredentialEncoding::observe(value), expected);
        }
    }

    #[test]
    fn late_malformed_armor_preserves_all_opened_fields() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::oauth_snapshot(&OAuthCredentialFixture {
            access: "valid access",
            refresh: Some("valid refresh"),
        });
        snapshot.seal_credentials(&identity)?;
        let oauth = snapshot.providers[0]
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("OAuth fixture is required"))?;
        oauth.refresh_token = StoredOAuthRefreshCredential::Token(AGE_ARMOR_MARKER.to_owned());
        let sealed = snapshot.clone();
        ExpectedCredentialFailure::AnyError.verify(snapshot.open_credentials(&identity))?;
        assert_eq!(snapshot, sealed);
        Ok(())
    }
}
