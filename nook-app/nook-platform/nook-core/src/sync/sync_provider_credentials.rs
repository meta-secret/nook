//! Device-key sealing for sync-provider credential fields inside a persisted
//! snapshot (`githubPat`, OAuth `accessToken` / `refreshToken`, and the S3
//! `secretAccessKey`).

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
use crate::{S3ProviderConfig, StoredS3Configuration, StoredS3SecretAccessKey};
use std::mem;
use zeroize::{Zeroize, Zeroizing};

mod storage_admission;
pub use storage_admission::{ProviderCredentialEncoding, ProviderCredentialStorageAdmission};

/// Marker substring present in every age-armored credential ciphertext.
pub const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";

/// Rejected transitions retain the original snapshot, including its encrypted fields.
pub struct ProviderCredentialRejection {
    pub snapshot: AuthProvidersSnapshotData,
    pub cause: MultiDeviceError,
}
impl ProviderCredentialRejection {
    /// Discard an admitted snapshot at a failed I/O boundary without retaining tokens.
    #[must_use]
    pub fn into_cause(mut self) -> MultiDeviceError {
        for provider in &mut self.snapshot.providers {
            provider.zeroize_credentials();
        }
        self.cause
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderCredentialOpening {
    Unchanged,
    Opened,
}
impl PreparedProviderCredentials {
    fn opening_evidence(&self, provider: &StorageProviderData) -> ProviderCredentialOpening {
        if let StoredGithubPat::Token(value) = &provider.github_pat
            && self.github.opening_evidence(value) == ProviderCredentialOpening::Opened
        {
            return ProviderCredentialOpening::Opened;
        }
        if let StoredOAuthFileConfiguration::Configured(oauth) = &provider.oauth_file {
            if let StoredOAuthAccessCredential::AccessToken(value) = &oauth.access_token
                && self.access.opening_evidence(value) == ProviderCredentialOpening::Opened
            {
                return ProviderCredentialOpening::Opened;
            }
            if let StoredOAuthRefreshCredential::Token(value) = &oauth.refresh_token
                && self.refresh.opening_evidence(value) == ProviderCredentialOpening::Opened
            {
                return ProviderCredentialOpening::Opened;
            }
        }
        if let StoredS3Configuration::Configured(s3) = &provider.s3
            && let ProviderCredentialOpening::Opened =
                self.s3_secret.opening_evidence(s3.secret_access_key.text())
        {
            return ProviderCredentialOpening::Opened;
        }
        ProviderCredentialOpening::Unchanged
    }
}
impl AuthProvidersSnapshotData {
    /// Authenticate all credential fields and observe whether opening changes any
    /// bytes. Prepared plaintext buffers zeroize without becoming a snapshot.
    pub fn credential_opening_evidence(
        &self,
        identity: &DeviceIdentity,
    ) -> MultiDeviceResult<ProviderCredentialOpening> {
        let transition = CredentialTransition::Open(identity);
        let mut outcome = ProviderCredentialOpening::Unchanged;
        for provider in &self.providers {
            let prepared = transition.prepare(provider)?;
            if prepared.opening_evidence(provider) == ProviderCredentialOpening::Opened {
                outcome = ProviderCredentialOpening::Opened;
            }
        }
        Ok(outcome)
    }
}

#[derive(Clone, Copy)]
enum CredentialTransition<'a> {
    Seal(&'a DevicePublicKey),
    Open(&'a DeviceIdentity),
}

enum PreparedCredentialProjection {
    Unchanged,
    Transformed(Zeroizing<String>),
}
impl PreparedCredentialProjection {
    fn opening_evidence(&self, original: &str) -> ProviderCredentialOpening {
        match self {
            Self::Unchanged => ProviderCredentialOpening::Unchanged,
            Self::Transformed(value) if value.as_str() == original => {
                ProviderCredentialOpening::Unchanged
            }
            Self::Transformed(_) => ProviderCredentialOpening::Opened,
        }
    }
}
struct PreparedProviderCredentials {
    github: PreparedCredentialProjection,
    access: PreparedCredentialProjection,
    refresh: PreparedCredentialProjection,
    s3_secret: PreparedCredentialProjection,
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
                StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
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
                    preset: oauth.preset,
                    expires_at: oauth.expires_at.clone(),
                    file_id: oauth.file_id.clone(),
                    folder_id: oauth.folder_id.clone(),
                    icloud_share_target: oauth.icloud_share_target.clone(),
                    file_name: oauth.file_name.clone(),
                    account_email: oauth.account_email.clone(),
                })
            }
        };
        let s3 = match &provider.s3 {
            StoredS3Configuration::NotApplicable => StoredS3Configuration::NotApplicable,
            StoredS3Configuration::Configured(config) => {
                StoredS3Configuration::Configured(S3ProviderConfig {
                    endpoint: config.endpoint.clone(),
                    region: config.region.clone(),
                    bucket: config.bucket.clone(),
                    key_prefix: config.key_prefix.clone(),
                    access_key_id: config.access_key_id.clone(),
                    secret_access_key: StoredS3SecretAccessKey::transitioned(
                        self.project_field(config.secret_access_key.text())?,
                    ),
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
            s3,
            store_id: provider.store_id.clone(),
            sync_checkpoint: provider.sync_checkpoint.clone(),
            created_at: provider.created_at.clone(),
        })
    }
    fn project_field(&self, value: &str) -> MultiDeviceResult<String> {
        match self.field(value)? {
            PreparedCredentialProjection::Transformed(mut prepared) => {
                Ok(mem::take(&mut *prepared))
            }
            PreparedCredentialProjection::Unchanged => Ok(value.to_owned()),
        }
    }
    fn prepare(
        &self,
        provider: &StorageProviderData,
    ) -> MultiDeviceResult<PreparedProviderCredentials> {
        let github = match &provider.github_pat {
            StoredGithubPat::Missing => PreparedCredentialProjection::Unchanged,
            StoredGithubPat::Token(value) => self.field(value)?,
        };
        let (access, refresh) = match &provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(oauth) => (
                match &oauth.access_token {
                    StoredOAuthAccessCredential::SignedOut => {
                        PreparedCredentialProjection::Unchanged
                    }
                    StoredOAuthAccessCredential::AccessToken(value) => self.field(value)?,
                },
                match &oauth.refresh_token {
                    StoredOAuthRefreshCredential::NotIssued => {
                        PreparedCredentialProjection::Unchanged
                    }
                    StoredOAuthRefreshCredential::Token(value) => self.field(value)?,
                },
            ),
            StoredOAuthFileConfiguration::NotApplicable => (
                PreparedCredentialProjection::Unchanged,
                PreparedCredentialProjection::Unchanged,
            ),
        };
        let s3_secret = match &provider.s3 {
            StoredS3Configuration::NotApplicable => PreparedCredentialProjection::Unchanged,
            StoredS3Configuration::Configured(config) => {
                self.field(config.secret_access_key.text())?
            }
        };
        Ok(PreparedProviderCredentials {
            github,
            access,
            refresh,
            s3_secret,
        })
    }
    fn field(&self, value: &str) -> MultiDeviceResult<PreparedCredentialProjection> {
        if value.is_empty() {
            return Ok(PreparedCredentialProjection::Unchanged);
        }
        match self {
            Self::Seal(key) if !ProviderCredentialField::has_armor_marker(value) => {
                Ok(PreparedCredentialProjection::Transformed(Zeroizing::new(
                    key.seal_bytes(value.as_bytes())?.into_inner(),
                )))
            }
            Self::Seal(_) => Ok(PreparedCredentialProjection::Unchanged),
            Self::Open(identity) if ProviderCredentialField::has_armor_marker(value) => {
                Ok(PreparedCredentialProjection::Transformed(Zeroizing::new(
                    identity.open_utf8(&AgeArmoredCiphertext::parse(value)?)?,
                )))
            }
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
            if let (
                StoredGithubPat::Token(value),
                PreparedCredentialProjection::Transformed(mut replacement),
            ) = (&mut provider.github_pat, prepared.github)
            {
                mem::swap(value, &mut replacement);
            }
            if let StoredOAuthFileConfiguration::Configured(oauth) = &mut provider.oauth_file {
                if let (
                    StoredOAuthAccessCredential::AccessToken(value),
                    PreparedCredentialProjection::Transformed(mut replacement),
                ) = (&mut oauth.access_token, prepared.access)
                {
                    mem::swap(value, &mut replacement);
                }
                if let (
                    StoredOAuthRefreshCredential::Token(value),
                    PreparedCredentialProjection::Transformed(mut replacement),
                ) = (&mut oauth.refresh_token, prepared.refresh)
                {
                    mem::swap(value, &mut replacement);
                }
            }
            if let StoredS3Configuration::Configured(config) = &mut provider.s3
                && let PreparedCredentialProjection::Transformed(mut replacement) =
                    prepared.s3_secret
            {
                config.secret_access_key =
                    StoredS3SecretAccessKey::transitioned(mem::take(&mut *replacement));
            }
        }
        Ok(self)
    }

    /// Authenticate every nonempty credential for an exact recipient without
    /// retaining the decrypted plaintext.
    pub fn authenticate_credentials_for(&self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        for provider in &self.providers {
            for text in provider.credential_texts() {
                ProviderCredentialField::authenticate(text, identity)?;
            }
        }
        Ok(())
    }

    /// Hash the canonical typed provider snapshot, including encrypted fields.
    pub fn companion_pairing_manifest_digest(&self) -> serde_json::Result<Sha256Hex> {
        Ok(Sha256Hex::from_bytes(&serde_json::to_vec(self)?))
    }
}

impl StorageProviderData {
    /// Every stored credential text of this row, in field order: the GitHub
    /// token, the OAuth access and refresh tokens, and the S3 secret access
    /// key. These are the fields sealing protects at rest.
    fn credential_texts(&self) -> Vec<&str> {
        let mut texts = Vec::new();
        if let StoredGithubPat::Token(token) = &self.github_pat {
            texts.push(token.as_str());
        }
        if let StoredOAuthFileConfiguration::Configured(oauth) = &self.oauth_file {
            if let StoredOAuthAccessCredential::AccessToken(token) = &oauth.access_token {
                texts.push(token.as_str());
            }
            if let StoredOAuthRefreshCredential::Token(token) = &oauth.refresh_token {
                texts.push(token.as_str());
            }
        }
        if let StoredS3Configuration::Configured(config) = &self.s3 {
            texts.push(config.secret_access_key.text());
        }
        texts
    }

    /// Clear every credential allocation owned by this provider row.
    pub fn zeroize_credentials(&mut self) {
        if let StoredGithubPat::Token(token) = &mut self.github_pat {
            token.zeroize();
        }
        if let StoredOAuthFileConfiguration::Configured(oauth) = &mut self.oauth_file {
            if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                token.zeroize();
            }
            if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                token.zeroize();
            }
        }
        if let StoredS3Configuration::Configured(config) = &mut self.s3 {
            config.secret_access_key.zeroize();
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
        ActiveVaultScope, ProviderSyncCheckpoint, ProviderVaultScope, StoredGithubPat,
        StoredGithubRepository, StoredGoogleDriveFolder, StoredICloudShareTarget,
        StoredLocalFolderConfiguration, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
        StoredOAuthFileConfiguration, StoredOAuthRefreshCredential, StoredOAuthRemoteFileId,
        StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
    };

    use std::io;
    use zeroize::Zeroize;

    use super::{
        AGE_ARMOR_MARKER, AuthProvidersSnapshotData, MultiDeviceError, MultiDeviceResult,
        ProviderCredentialField, ProviderCredentialOpening, ProviderCredentialRejection,
        ProviderCredentialStorageAdmission,
    };
    use crate::{
        DeviceIdentity, OAuthFileConfigData, OauthFilePreset, S3ProviderConfig,
        StorageProviderData, StorageProviderType, StoredS3Configuration,
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
        refresh: &'a str,
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
                        refresh_token: StoredOAuthRefreshCredential::Token(refresh.to_owned()),
                        expires_at: StoredOAuthTokenExpiry::Unknown,
                        file_id: StoredOAuthRemoteFileId::Unresolved,
                        folder_id: StoredGoogleDriveFolder::Root,
                        icloud_share_target: StoredICloudShareTarget::Unbound,
                        file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
                        account_email: StoredOAuthAccountIdentity::Email(
                            "me@example.com".to_owned(),
                        ),
                    }),
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    s3: StoredS3Configuration::NotApplicable,
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
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let Some(StorageProviderData {
            github_pat: StoredGithubPat::Token(stored),
            ..
        }) = snapshot.providers.first()
        else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        opened = opened
            .open_credentials(&identity)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            opened
                .providers
                .first()
                .map(|provider| &provider.github_pat),
            Some(&StoredGithubPat::Token(pat.to_owned()))
        );
        Ok(())
    }

    #[test]
    fn seal_and_open_oauth_tokens_round_trips() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let access = "ya29.oauth-access-token";
        let refresh = "1//refresh-token-secret";
        let mut snapshot =
            AuthProvidersSnapshotData::oauth_snapshot(&OAuthCredentialFixture { access, refresh });
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let Some(StorageProviderData {
            oauth_file: StoredOAuthFileConfiguration::Configured(oauth),
            ..
        }) = snapshot.providers.first()
        else {
            return Err((io::Error::other("test as_ref value must exist")).into());
        };
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
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let Some(StorageProviderData {
            oauth_file: StoredOAuthFileConfiguration::Configured(opened_oauth),
            ..
        }) = opened.providers.first()
        else {
            return Err((io::Error::other("test as_ref value must exist")).into());
        };
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
        let snapshot = AuthProvidersSnapshotData::github_snapshot(pat);
        ExpectedCredentialFailure::Unsealed.verify_open(snapshot.open_credentials(&identity))?;
        Ok(())
    }

    #[test]
    fn seal_is_idempotent_for_already_sealed_fields() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11AAAA");
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let sealed_once = snapshot
            .providers
            .first()
            .map(|provider| provider.github_pat.clone());
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            snapshot
                .providers
                .first()
                .map(|provider| provider.github_pat.clone()),
            sealed_once
        );
        Ok(())
    }

    #[test]
    fn sealed_credentials_fail_on_wrong_device() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::github_snapshot("github_pat_11SECRET");
        snapshot = snapshot
            .seal_credentials(&owner)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
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
            refresh: "invalid plaintext refresh",
        });
        let Some(provider) = snapshot.providers.first_mut() else {
            return Err(io::Error::other("OAuth fixture provider must exist").into());
        };
        let oauth = (match &mut provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(io::Error::other("test as_mut value must exist"))
            }
        })?;
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
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let Some(StorageProviderData {
            github_pat: StoredGithubPat::Token(stored),
            ..
        }) = snapshot.providers.first()
        else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(ProviderCredentialField::has_armor_marker(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        opened = opened
            .open_credentials(&extension)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            opened
                .providers
                .first()
                .map(|provider| &provider.github_pat),
            Some(&StoredGithubPat::Token(pat.to_owned()))
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
                refresh: "oauth-refresh-pairing",
            })
            .providers,
        );
        snapshot = snapshot
            .seal_credentials_for(&recipient.public_key())
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let digest = snapshot.companion_pairing_manifest_digest()?;

        snapshot.authenticate_credentials_for(&recipient)?;
        ExpectedCredentialFailure::AnyError
            .verify(snapshot.authenticate_credentials_for(&other))?;
        let Some(provider) = snapshot.providers.first_mut() else {
            return Err(io::Error::other("pairing fixture provider must exist").into());
        };
        provider.label = "Substituted".to_owned();
        assert_ne!(snapshot.companion_pairing_manifest_digest()?, digest);
        Ok(())
    }

    impl AuthProvidersSnapshotData {
        fn s3_snapshot() -> anyhow::Result<AuthProvidersSnapshotData> {
            let mut row = StorageProviderData::github("s3-1", "S3 · nook-dev", "", "", "now");
            row.provider_type = StorageProviderType::S3;
            row.github_pat = StoredGithubPat::Missing;
            row.s3 = StoredS3Configuration::Configured(S3ProviderConfig::fixture()?);
            Ok(AuthProvidersSnapshotData {
                providers: vec![row],
                active_vault_store_id: ActiveVaultScope::Unselected,
            })
        }

        fn s3_secret_text(&self) -> anyhow::Result<String> {
            match self.providers.first().map(|provider| &provider.s3) {
                Some(StoredS3Configuration::Configured(config)) => {
                    Ok(config.secret_access_key.text().to_owned())
                }
                Some(StoredS3Configuration::NotApplicable) | None => {
                    anyhow::bail!("the S3 fixture row must be configured")
                }
            }
        }
    }

    #[test]
    fn seal_and_open_the_s3_secret_beside_its_readable_location() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let snapshot = AuthProvidersSnapshotData::s3_snapshot()?;
        let plaintext = snapshot.s3_secret_text()?;
        let sealed = snapshot
            .clone()
            .seal_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        let stored = sealed.s3_secret_text()?;
        assert!(ProviderCredentialField::has_armor_marker(&stored));
        assert!(!stored.contains(&plaintext));
        // Only the secret is sealed: the location and key id stay readable.
        let wire = serde_json::to_string(&sealed)?;
        assert!(wire.contains("nook-dev") && wire.contains("device-a"));
        assert!(!wire.contains(&plaintext));
        assert_eq!(
            sealed.credential_opening_evidence(&identity)?,
            ProviderCredentialOpening::Opened
        );
        let resealed = sealed
            .clone()
            .seal_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(resealed, sealed);
        let opened = sealed
            .open_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(opened, snapshot);
        Ok(())
    }

    #[test]
    fn open_rejects_a_plaintext_s3_secret_and_keeps_the_row() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let snapshot = AuthProvidersSnapshotData::s3_snapshot()?;
        let kept = ExpectedCredentialFailure::Unsealed
            .verify_open(snapshot.clone().open_credentials(&identity))?;
        assert_eq!(kept, snapshot);
        Ok(())
    }

    #[test]
    fn an_s3_secret_staged_for_another_app_opens_only_there() -> anyhow::Result<()> {
        let website = DeviceIdentity::generate()?;
        let extension = DeviceIdentity::generate()?;
        let snapshot = AuthProvidersSnapshotData::s3_snapshot()?;
        let staged = snapshot
            .clone()
            .seal_credentials_for(&extension.public_key())
            .map_err(ProviderCredentialRejection::into_cause)?;
        staged.authenticate_credentials_for(&extension)?;
        ExpectedCredentialFailure::AnyError
            .verify(staged.authenticate_credentials_for(&website))?;
        let rejected = ExpectedCredentialFailure::AnyError
            .verify_open(staged.clone().open_credentials(&website))?;
        assert_eq!(rejected, staged);
        let opened = staged
            .open_credentials(&extension)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(opened, snapshot);
        Ok(())
    }

    #[test]
    fn zeroizing_a_row_wipes_its_s3_secret() -> anyhow::Result<()> {
        let mut snapshot = AuthProvidersSnapshotData::s3_snapshot()?;
        for provider in &mut snapshot.providers {
            provider.zeroize_credentials();
        }
        assert_eq!(snapshot.s3_secret_text()?, "");
        Ok(())
    }

    #[test]
    fn late_malformed_armor_preserves_all_opened_fields() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::oauth_snapshot(&OAuthCredentialFixture {
            access: "valid access",
            refresh: "valid refresh",
        });
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(super::ProviderCredentialRejection::into_cause)?;
        let Some(provider) = snapshot.providers.first_mut() else {
            return Err(io::Error::other("OAuth fixture provider must exist").into());
        };
        let oauth = (match &mut provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(io::Error::other("OAuth fixture is required"))
            }
        })?;
        oauth.refresh_token = StoredOAuthRefreshCredential::Token(AGE_ARMOR_MARKER.to_owned());
        let sealed = snapshot.clone();
        snapshot = ExpectedCredentialFailure::AnyError
            .verify_open(snapshot.open_credentials(&identity))?;
        assert_eq!(snapshot, sealed);
        Ok(())
    }
    #[test]
    fn opening_evidence_requires_every_credential_and_never_publishes_plaintext()
    -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let foreign = DeviceIdentity::generate()?;
        let original = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData::github(
                "one",
                "GitHub",
                "credential",
                "repo",
                "now",
            )],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        assert!(original.credential_opening_evidence(&identity).is_err());
        let sealed = original.sealed_credentials_projection(&identity)?;
        assert_eq!(
            sealed.credential_opening_evidence(&identity)?,
            ProviderCredentialOpening::Opened
        );
        assert!(sealed.credential_opening_evidence(&foreign).is_err());
        assert_eq!(
            sealed.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        let mut mixed = sealed;
        mixed.providers.push(StorageProviderData::github(
            "two",
            "GitHub",
            AGE_ARMOR_MARKER,
            "repo",
            "now",
        ));
        assert!(mixed.credential_opening_evidence(&identity).is_err());
        Ok(())
    }
}
