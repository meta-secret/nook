//! Device-key sealing for sync-provider credential fields inside a persisted
//! snapshot (`githubPat`, OAuth `accessToken` / `refreshToken`).

use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, DeviceIdentity, DevicePublicKey,
    StoredGithubPat, StoredOAuthAccessCredential, StoredOAuthRefreshCredential,
    encrypt_for_recipient,
    errors::{MultiDeviceError, MultiDeviceResult},
};

/// Marker substring present in every age-armored credential ciphertext.
pub const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";

/// True when a stored credential field is already sealed with the device key.
#[must_use]
pub fn is_sealed_credential(value: &str) -> bool {
    value.contains(AGE_ARMOR_MARKER)
}

fn seal_credential(identity: &DeviceIdentity, field: &mut String) -> MultiDeviceResult<()> {
    if !field.is_empty() && !is_sealed_credential(field) {
        *field = identity.seal_utf8(field)?.into_inner();
    }
    Ok(())
}

fn seal_credential_for_public_key(
    public_key: &DevicePublicKey,
    field: &mut String,
) -> MultiDeviceResult<()> {
    if !field.is_empty() && !is_sealed_credential(field) {
        *field = encrypt_for_recipient(field.as_bytes(), public_key)?.into_inner();
    }
    Ok(())
}

/// Seal every credential field in `snapshot` with `identity` (in place).
pub fn seal_provider_credentials(
    identity: &DeviceIdentity,
    snapshot: &mut AuthProvidersSnapshotData,
) -> MultiDeviceResult<()> {
    for provider in &mut snapshot.providers {
        if let StoredGithubPat::Token(token) = &mut provider.github_pat {
            seal_credential(identity, token)?;
        }
        if let Some(oauth) = provider.oauth_file.as_mut() {
            if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                seal_credential(identity, token)?;
            }
            if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                seal_credential(identity, token)?;
            }
        }
    }
    Ok(())
}

/// Seal every plaintext credential field in `snapshot` for another device's
/// public key (in place), without requiring the recipient device's private key.
pub fn seal_provider_credentials_for_public_key(
    public_key: &DevicePublicKey,
    snapshot: &mut AuthProvidersSnapshotData,
) -> MultiDeviceResult<()> {
    for provider in &mut snapshot.providers {
        if let StoredGithubPat::Token(token) = &mut provider.github_pat {
            seal_credential_for_public_key(public_key, token)?;
        }
        if let Some(oauth) = provider.oauth_file.as_mut() {
            if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                seal_credential_for_public_key(public_key, token)?;
            }
            if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                seal_credential_for_public_key(public_key, token)?;
            }
        }
    }
    Ok(())
}

fn open_credential(identity: &DeviceIdentity, field: &mut String) -> MultiDeviceResult<()> {
    if field.is_empty() {
        return Ok(());
    }
    if is_sealed_credential(field) {
        *field = identity.open_utf8(&AgeArmoredCiphertext::parse(field)?)?;
    } else {
        return Err(MultiDeviceError::UnsealedProviderCredential);
    }
    Ok(())
}

/// Unseal credential fields in `snapshot` (in place).
///
/// Plaintext stored credentials are rejected; only the current encrypted
/// storage schema is accepted.
pub fn open_provider_credentials(
    identity: &DeviceIdentity,
    snapshot: &mut AuthProvidersSnapshotData,
) -> MultiDeviceResult<()> {
    let mut opened = snapshot.clone();
    for provider in &mut opened.providers {
        if let StoredGithubPat::Token(token) = &mut provider.github_pat {
            open_credential(identity, token)?;
        }
        if let Some(oauth) = provider.oauth_file.as_mut() {
            if let StoredOAuthAccessCredential::AccessToken(token) = &mut oauth.access_token {
                open_credential(identity, token)?;
            }
            if let StoredOAuthRefreshCredential::Token(token) = &mut oauth.refresh_token {
                open_credential(identity, token)?;
            }
        }
    }
    *snapshot = opened;
    Ok(())
}

fn field_is_presealed(value: &str) -> bool {
    value.is_empty() || is_sealed_credential(value)
}

/// True when every credential field is empty or already age-sealed.
///
/// Used by extension pairing to persist website-sealed provider grants without
/// requiring an unlocked device session in the offscreen document.
#[must_use]
pub fn provider_credentials_are_presealed(snapshot: &AuthProvidersSnapshotData) -> bool {
    snapshot.providers.iter().all(|provider| {
        provider
            .github_pat
            .as_deref()
            .is_none_or(field_is_presealed)
            && provider.oauth_file.as_ref().is_none_or(|oauth| {
                oauth.access_token.as_deref().is_none_or(field_is_presealed)
                    && oauth
                        .refresh_token
                        .as_deref()
                        .is_none_or(field_is_presealed)
            })
    })
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;
    use crate::{
        DeviceIdentity, ICloudMode, OAuthFileConfigData, OauthFilePreset, StorageProviderData,
        StorageProviderType,
    };

    fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData::github(
                "gh-1",
                "GitHub",
                pat,
                "nook",
                "2026-06-24T00:00:00.000Z",
            )],
            active_vault_store_id: crate::ActiveVaultScope::Unselected,
        }
    }

    fn oauth_snapshot(access: &str, refresh: Option<&str>) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gd-1".to_owned(),
                provider_type: StorageProviderType::OauthFile,
                label: "Google Drive".to_owned(),
                github_pat: crate::StoredGithubPat::Missing,
                github_repo: crate::StoredGithubRepository::DefaultRepository,
                oauth_file: crate::StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                    preset: OauthFilePreset::GoogleDrive,
                    access_token: crate::StoredOAuthAccessCredential::AccessToken(
                        access.to_owned(),
                    ),
                    refresh_token: crate::StoredOAuthRefreshCredential::from_option(
                        refresh.map(str::to_owned),
                    ),
                    expires_at: crate::StoredOAuthTokenExpiry::Unknown,
                    file_id: crate::StoredOAuthRemoteFileId::Unresolved,
                    folder_id: crate::StoredGoogleDriveFolder::Root,
                    drive_mode: crate::GoogleDriveMode::Private,
                    icloud_mode: ICloudMode::Private,
                    icloud_share_target: crate::StoredICloudShareTarget::Personal,
                    file_name: crate::StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
                    account_email: crate::StoredOAuthAccountIdentity::Email(
                        "me@example.com".to_owned(),
                    ),
                }),
                local_folder: crate::StoredLocalFolderConfiguration::NotApplicable,
                store_id: crate::ProviderVaultScope::Unscoped,
                sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: crate::ActiveVaultScope::Unselected,
        }
    }

    #[test]
    fn seal_and_open_github_pat_round_trips() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let pat = "github_pat_11AAAAbbbbCCCC";
        let mut snapshot = github_snapshot(pat);
        seal_provider_credentials(&identity, &mut snapshot)?;
        let StoredGithubPat::Token(stored) = &snapshot.providers[0].github_pat else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(is_sealed_credential(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        open_provider_credentials(&identity, &mut opened)?;
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
        let mut snapshot = oauth_snapshot(access, Some(refresh));
        seal_provider_credentials(&identity, &mut snapshot)?;
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
        assert!(is_sealed_credential(stored_access));
        assert!(is_sealed_credential(stored_refresh));
        assert!(!stored_access.contains(access));
        assert!(!stored_refresh.contains(refresh));

        let mut opened = snapshot;
        open_provider_credentials(&identity, &mut opened)?;
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
        let mut snapshot = github_snapshot(pat);
        assert!(matches!(
            open_provider_credentials(&identity, &mut snapshot),
            Err(MultiDeviceError::UnsealedProviderCredential)
        ));
        Ok(())
    }

    #[test]
    fn seal_is_idempotent_for_already_sealed_fields() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = github_snapshot("github_pat_11AAAA");
        seal_provider_credentials(&identity, &mut snapshot)?;
        let sealed_once = snapshot.providers[0].github_pat.clone();
        seal_provider_credentials(&identity, &mut snapshot)?;
        assert_eq!(snapshot.providers[0].github_pat, sealed_once);
        Ok(())
    }

    #[test]
    fn sealed_credentials_fail_on_wrong_device() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let mut snapshot = github_snapshot("github_pat_11SECRET");
        seal_provider_credentials(&owner, &mut snapshot)?;
        let sealed = snapshot.clone();
        assert!(open_provider_credentials(&other, &mut snapshot).is_err());
        assert_eq!(snapshot, sealed);
        Ok(())
    }

    #[test]
    fn open_failure_does_not_partially_decrypt_snapshot() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = oauth_snapshot("ya29.valid-access", Some("invalid plaintext refresh"));
        let oauth = snapshot.providers[0]
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("test as_mut value must exist"))?;
        let StoredOAuthAccessCredential::AccessToken(access_token) = &mut oauth.access_token else {
            return Err(io::Error::other("plaintext access token must be present").into());
        };
        seal_credential(&identity, access_token)?;
        let sealed = snapshot.clone();

        assert!(matches!(
            open_provider_credentials(&identity, &mut snapshot),
            Err(MultiDeviceError::UnsealedProviderCredential)
        ));
        assert_eq!(snapshot, sealed);
        Ok(())
    }

    #[test]
    fn seal_for_public_key_opens_on_recipient_device() -> anyhow::Result<()> {
        let extension = DeviceIdentity::generate()?;
        let pat = "github_pat_11EXTENSIONgrant";
        let mut snapshot = github_snapshot(pat);
        seal_provider_credentials_for_public_key(&extension.public_key(), &mut snapshot)?;
        let StoredGithubPat::Token(stored) = &snapshot.providers[0].github_pat else {
            return Err(io::Error::other("sealed GitHub PAT must be present").into());
        };
        assert!(is_sealed_credential(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        open_provider_credentials(&extension, &mut opened)?;
        assert_eq!(
            opened.providers[0].github_pat,
            StoredGithubPat::Token(pat.to_owned())
        );
        Ok(())
    }

    #[test]
    fn presealed_check_accepts_sealed_or_empty_credentials() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = github_snapshot("github_pat_11PRESEAL");
        assert!(!provider_credentials_are_presealed(&snapshot));
        seal_provider_credentials(&identity, &mut snapshot)?;
        assert!(provider_credentials_are_presealed(&snapshot));
        assert!(provider_credentials_are_presealed(
            &AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: crate::ActiveVaultScope::StoreId("store-1".to_owned()),
            }
        ));
        Ok(())
    }
}
