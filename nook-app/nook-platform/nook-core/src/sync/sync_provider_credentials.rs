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
use crate::{OAuthFileConfigData, StorageProviderData, StoredOAuthFileConfiguration};
use std::mem;
use zeroize::{Zeroize, Zeroizing};

/// Marker substring present in every age-armored credential ciphertext.
pub const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";

/// Rejected transitions retain the original snapshot, including its encrypted fields.
pub struct ProviderCredentialRejection {
    pub snapshot: AuthProvidersSnapshotData,
    pub cause: MultiDeviceError,
}
impl ProviderCredentialRejection {
    /// Discard an admitted snapshot at a failed I/O boundary without retaining tokens.
    pub fn into_cause(mut self) -> MultiDeviceError {
        for provider in &mut self.snapshot.providers {
            if let StoredGithubPat::Token(value) = &mut provider.github_pat {
                value.zeroize();
            }
            if let StoredOAuthFileConfiguration::Configured(oauth) = &mut provider.oauth_file {
                if let StoredOAuthAccessCredential::AccessToken(value) = &mut oauth.access_token {
                    value.zeroize();
                }
                if let StoredOAuthRefreshCredential::Token(value) = &mut oauth.refresh_token {
                    value.zeroize();
                }
            }
        }
        self.cause
    }
}

enum CredentialTransition<'a> {
    Seal(&'a DevicePublicKey),
    Open(&'a DeviceIdentity),
}

struct PreparedProviderCredentials {
    github: Option<Zeroizing<String>>,
    access: Option<Zeroizing<String>>,
    refresh: Option<Zeroizing<String>>,
}
impl CredentialTransition<'_> {
    fn project(&self, provider: &StorageProviderData) -> MultiDeviceResult<StorageProviderData> {
        let github_pat = match &provider.github_pat {
            StoredGithubPat::Missing => StoredGithubPat::Missing,
            StoredGithubPat::Token(value) => StoredGithubPat::Token(self.project_field(value)?),
        };
        let oauth_file = match &provider.oauth_file {
            StoredOAuthFileConfiguration::NotApplicable => {
                StoredOAuthFileConfiguration::NotApplicable
            }
            StoredOAuthFileConfiguration::Configured(oauth) => {
                StoredOAuthFileConfiguration::Configured(OAuthFileConfigData {
                    access_token: match &oauth.access_token {
                        StoredOAuthAccessCredential::SignedOut => {
                            StoredOAuthAccessCredential::SignedOut
                        }
                        StoredOAuthAccessCredential::AccessToken(value) => {
                            StoredOAuthAccessCredential::AccessToken(self.project_field(value)?)
                        }
                    },
                    refresh_token: match &oauth.refresh_token {
                        StoredOAuthRefreshCredential::NotIssued => {
                            StoredOAuthRefreshCredential::NotIssued
                        }
                        StoredOAuthRefreshCredential::Token(value) => {
                            StoredOAuthRefreshCredential::Token(self.project_field(value)?)
                        }
                    },
                    preset: oauth.preset.clone(),
                    expires_at: oauth.expires_at.clone(),
                    file_id: oauth.file_id.clone(),
                    folder_id: oauth.folder_id.clone(),
                    drive_mode: oauth.drive_mode,
                    icloud_mode: oauth.icloud_mode,
                    icloud_share_target: oauth.icloud_share_target.clone(),
                    file_name: oauth.file_name.clone(),
                    account_email: oauth.account_email.clone(),
                })
            }
        };
        Ok(StorageProviderData {
            id: provider.id.clone(),
            provider_type: provider.provider_type,
            label: provider.label.clone(),
            github_pat,
            github_repo: provider.github_repo.clone(),
            oauth_file,
            local_folder: provider.local_folder.clone(),
            store_id: provider.store_id.clone(),
            sync_checkpoint: provider.sync_checkpoint.clone(),
            created_at: provider.created_at.clone(),
        })
    }
    fn project_field(&self, value: &str) -> MultiDeviceResult<String> {
        match self.field(value)? {
            Some(mut prepared) => Ok(mem::take(&mut *prepared)),
            None => Ok(value.to_owned()),
        }
    }
    fn prepare(
        &self,
        provider: &StorageProviderData,
    ) -> MultiDeviceResult<PreparedProviderCredentials> {
        let github = provider
            .github_pat
            .as_deref()
            .map(|value| self.field(value))
            .transpose()?
            .flatten();
        let (access, refresh) = match provider.oauth_file.as_ref() {
            Some(oauth) => (
                oauth
                    .access_token
                    .as_deref()
                    .map(|value| self.field(value))
                    .transpose()?
                    .flatten(),
                oauth
                    .refresh_token
                    .as_deref()
                    .map(|value| self.field(value))
                    .transpose()?
                    .flatten(),
            ),
            None => (None, None),
        };
        Ok(PreparedProviderCredentials {
            github,
            access,
            refresh,
        })
    }
    fn field(&self, value: &str) -> MultiDeviceResult<Option<Zeroizing<String>>> {
        if value.is_empty() {
            return Ok(None);
        }
        match self {
            Self::Seal(key) if !ProviderCredentialField::has_armor_marker(value) => Ok(Some(
                Zeroizing::new(key.seal_bytes(value.as_bytes())?.into_inner()),
            )),
            Self::Seal(_) => Ok(None),
            Self::Open(identity) if ProviderCredentialField::has_armor_marker(value) => Ok(Some(
                Zeroizing::new(identity.open_utf8(&AgeArmoredCiphertext::parse(value)?)?),
            )),
            Self::Open(_) => Err(MultiDeviceError::UnsealedProviderCredential),
        }
    }
}
impl AuthProvidersSnapshotData {
    /// Produce an encrypted storage projection without copying plaintext credentials.
    pub fn sealed_credentials_projection(
        &self,
        identity: &DeviceIdentity,
    ) -> MultiDeviceResult<Self> {
        let public_key = identity.public_key();
        let transition = CredentialTransition::Seal(&public_key);
        let providers = self
            .providers
            .iter()
            .map(|provider| transition.project(provider))
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        Ok(Self {
            providers,
            active_vault_store_id: self.active_vault_store_id.clone(),
        })
    }
    pub fn seal_credentials(
        self,
        identity: &DeviceIdentity,
    ) -> Result<Self, ProviderCredentialRejection> {
        self.seal_credentials_for(&identity.public_key())
    }
    pub fn seal_credentials_for(
        self,
        public_key: &DevicePublicKey,
    ) -> Result<Self, ProviderCredentialRejection> {
        self.transition_credentials(CredentialTransition::Seal(public_key))
    }
    pub fn open_credentials(
        self,
        identity: &DeviceIdentity,
    ) -> Result<Self, ProviderCredentialRejection> {
        self.transition_credentials(CredentialTransition::Open(identity))
    }
    fn transition_credentials(
        mut self,
        transition: CredentialTransition<'_>,
    ) -> Result<Self, ProviderCredentialRejection> {
        let prepared = self
            .providers
            .iter()
            .map(|provider| transition.prepare(provider))
            .collect::<MultiDeviceResult<Vec<_>>>();
        let prepared = match prepared {
            Ok(prepared) => prepared,
            Err(cause) => {
                return Err(ProviderCredentialRejection {
                    snapshot: self,
                    cause,
                });
            }
        };
        // Every fallible transformation completed. Swap owned replacements locally;
        // the displaced plaintext and any unapplied prepared fields zeroize on drop.
        for (provider, prepared) in self.providers.iter_mut().zip(prepared) {
            if let (StoredGithubPat::Token(value), Some(mut replacement)) =
                (&mut provider.github_pat, prepared.github)
            {
                mem::swap(value, &mut replacement);
            }
            if let StoredOAuthFileConfiguration::Configured(oauth) = &mut provider.oauth_file {
                if let (StoredOAuthAccessCredential::AccessToken(value), Some(mut replacement)) =
                    (&mut oauth.access_token, prepared.access)
                {
                    mem::swap(value, &mut replacement);
                }
                if let (StoredOAuthRefreshCredential::Token(value), Some(mut replacement)) =
                    (&mut oauth.refresh_token, prepared.refresh)
                {
                    mem::swap(value, &mut replacement);
                }
            }
        }
        Ok(self)
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
struct ProviderCredentialField;
impl ProviderCredentialField {
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
    use zeroize::Zeroize;

    use super::{
        AGE_ARMOR_MARKER, AuthProvidersSnapshotData, MultiDeviceError, MultiDeviceResult,
        ProviderCredentialEncoding, ProviderCredentialField, ProviderCredentialRejection,
        ProviderCredentialStorageAdmission,
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
        fn verify_open(
            self,
            result: Result<AuthProvidersSnapshotData, ProviderCredentialRejection>,
        ) -> anyhow::Result<AuthProvidersSnapshotData> {
            match result {
                Ok(_) => anyhow::bail!("credential opening unexpectedly succeeded"),
                Err(rejection) => {
                    self.verify(Err(rejection.cause))?;
                    Ok(rejection.snapshot)
                }
            }
        }
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
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        let StoredGithubPat::Token(stored) = &snapshot.providers[0].github_pat else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        opened = opened
            .open_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
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
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
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
        opened = opened
            .open_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
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
        snapshot = ExpectedCredentialFailure::Unsealed
            .verify_open(snapshot.open_credentials(&identity))?;
        Ok(())
    }

    #[test]
    fn seal_is_idempotent_for_already_sealed_fields() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11AAAA");
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        let sealed_once = snapshot.providers[0].github_pat.clone();
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        assert_eq!(snapshot.providers[0].github_pat, sealed_once);
        Ok(())
    }

    #[test]
    fn sealed_credentials_fail_on_wrong_device() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11SECRET");
        snapshot = snapshot
            .seal_credentials(&owner)
            .map_err(|rejection| rejection.into_cause())?;
        let sealed = snapshot.clone();
        snapshot =
            ExpectedCredentialFailure::AnyError.verify_open(snapshot.open_credentials(&other))?;
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
        let oauth = (match &mut snapshot.providers[0].oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("test as_mut value must exist"))?;
        let StoredOAuthAccessCredential::AccessToken(access_token) = &mut oauth.access_token else {
            return Err(io::Error::other("plaintext access token must be present").into());
        };
        let sealed_access = identity.seal_utf8(access_token)?.into_inner();
        access_token.zeroize();
        *access_token = sealed_access;
        let sealed = snapshot.clone();

        snapshot = ExpectedCredentialFailure::Unsealed
            .verify_open(snapshot.open_credentials(&identity))?;
        assert_eq!(snapshot, sealed);
        Ok(())
    }

    #[test]
    fn seal_for_public_key_opens_on_recipient_device() -> anyhow::Result<()> {
        let extension = DeviceIdentity::generate()?;
        let pat = "github_pat_11EXTENSIONgrant";
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot(pat);
        snapshot = snapshot
            .seal_credentials_for(&extension.public_key())
            .map_err(|rejection| rejection.into_cause())?;
        let StoredGithubPat::Token(stored) = &snapshot.providers[0].github_pat else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        opened = opened
            .open_credentials(&extension)
            .map_err(|rejection| rejection.into_cause())?;
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
        snapshot = snapshot
            .seal_credentials_for(&recipient.public_key())
            .map_err(|rejection| rejection.into_cause())?;
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
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
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
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        assert_eq!(snapshot, original);
        snapshot = snapshot
            .seal_credentials_for(&identity.public_key())
            .map_err(|rejection| rejection.into_cause())?;
        assert_eq!(snapshot, original);
        snapshot = ExpectedCredentialFailure::AnyError
            .verify_open(snapshot.open_credentials(&identity))?;
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
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        let oauth = (match &mut snapshot.providers[0].oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Some(config),
            StoredOAuthFileConfiguration::NotApplicable => None,
        })
        .ok_or_else(|| io::Error::other("OAuth fixture is required"))?;
        oauth.refresh_token = StoredOAuthRefreshCredential::Token(AGE_ARMOR_MARKER.to_owned());
        let sealed = snapshot.clone();
        snapshot = ExpectedCredentialFailure::AnyError
            .verify_open(snapshot.open_credentials(&identity))?;
        assert_eq!(snapshot, sealed);
        Ok(())
    }
}
