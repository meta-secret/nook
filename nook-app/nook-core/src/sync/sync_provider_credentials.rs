//! Device-key sealing for sync-provider credential fields inside a persisted
//! snapshot (`githubPat`, OAuth `accessToken` / `refreshToken`).

use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshotData, DeviceIdentity, DevicePublicKey,
    encrypt_for_recipient, errors::MultiDeviceResult,
};

/// Marker substring present in every age-armored credential ciphertext.
pub const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";

/// True when a stored credential field is already sealed with the device key.
#[must_use]
pub fn is_sealed_credential(value: &str) -> bool {
    value.contains(AGE_ARMOR_MARKER)
}

fn seal_optional(identity: &DeviceIdentity, field: &mut Option<String>) -> MultiDeviceResult<()> {
    let Some(text) = field.clone() else {
        return Ok(());
    };
    if !text.is_empty() && !is_sealed_credential(&text) {
        *field = Some(identity.seal_utf8(&text)?.into_inner());
    }
    Ok(())
}

fn seal_required(identity: &DeviceIdentity, field: &mut String) -> MultiDeviceResult<()> {
    if !field.is_empty() && !is_sealed_credential(field) {
        *field = identity.seal_utf8(field)?.into_inner();
    }
    Ok(())
}

fn seal_optional_for_public_key(
    public_key: &DevicePublicKey,
    field: &mut Option<String>,
) -> MultiDeviceResult<()> {
    let Some(text) = field.clone() else {
        return Ok(());
    };
    if !text.is_empty() && !is_sealed_credential(&text) {
        *field = Some(encrypt_for_recipient(text.as_bytes(), public_key)?.into_inner());
    }
    Ok(())
}

fn seal_required_for_public_key(
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
        seal_optional(identity, &mut provider.github_pat)?;
        if let Some(oauth) = provider.oauth_file.as_mut() {
            seal_required(identity, &mut oauth.access_token)?;
            seal_optional(identity, &mut oauth.refresh_token)?;
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
        seal_optional_for_public_key(public_key, &mut provider.github_pat)?;
        if let Some(oauth) = provider.oauth_file.as_mut() {
            seal_required_for_public_key(public_key, &mut oauth.access_token)?;
            seal_optional_for_public_key(public_key, &mut oauth.refresh_token)?;
        }
    }
    Ok(())
}

fn open_optional(
    identity: &DeviceIdentity,
    field: &mut Option<String>,
    had_plaintext: &mut bool,
) -> MultiDeviceResult<()> {
    let Some(text) = field.clone() else {
        return Ok(());
    };
    if text.is_empty() {
        return Ok(());
    }
    if is_sealed_credential(&text) {
        *field = Some(identity.open_utf8(&AgeArmoredCiphertext::parse(&text)?)?);
    } else {
        *had_plaintext = true;
    }
    Ok(())
}

fn open_required(
    identity: &DeviceIdentity,
    field: &mut String,
    had_plaintext: &mut bool,
) -> MultiDeviceResult<()> {
    if field.is_empty() {
        return Ok(());
    }
    if is_sealed_credential(field) {
        *field = identity.open_utf8(&AgeArmoredCiphertext::parse(field)?)?;
    } else {
        *had_plaintext = true;
    }
    Ok(())
}

/// Unseal credential fields in `snapshot` (in place). Returns `true` when any
/// field was still plaintext (legacy rows that should be re-saved sealed).
pub fn open_provider_credentials(
    identity: &DeviceIdentity,
    snapshot: &mut AuthProvidersSnapshotData,
) -> MultiDeviceResult<bool> {
    let mut had_plaintext = false;
    for provider in &mut snapshot.providers {
        open_optional(identity, &mut provider.github_pat, &mut had_plaintext)?;
        if let Some(oauth) = provider.oauth_file.as_mut() {
            open_required(identity, &mut oauth.access_token, &mut had_plaintext)?;
            open_optional(identity, &mut oauth.refresh_token, &mut had_plaintext)?;
        }
    }
    Ok(had_plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DeviceIdentity, OAuthFileConfigData, StorageProviderData};

    fn github_snapshot(pat: &str) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData::github(
                "gh-1",
                "GitHub",
                pat,
                "nook",
                "2026-06-24T00:00:00.000Z",
            )],
            active_vault_store_id: None,
        }
    }

    fn oauth_snapshot(access: &str, refresh: Option<&str>) -> AuthProvidersSnapshotData {
        AuthProvidersSnapshotData {
            providers: vec![StorageProviderData {
                id: "gd-1".to_owned(),
                provider_type: "oauth-file".to_owned(),
                label: "Google Drive".to_owned(),
                github_pat: None,
                github_repo: None,
                oauth_file: Some(OAuthFileConfigData {
                    preset: "google-drive".to_owned(),
                    access_token: access.to_owned(),
                    refresh_token: refresh.map(str::to_owned),
                    expires_at: None,
                    file_id: None,
                    folder_id: None,
                    drive_mode: Some(crate::GoogleDriveMode::Private),
                    icloud_mode: None,
                    icloud_share_target: None,
                    file_name: Some("nook-events".to_owned()),
                    account_email: Some("me@example.com".to_owned()),
                }),
                local_folder: None,
                store_id: None,
                last_synced_version: None,
                last_synced_at: None,
                last_sync_revision: None,
                last_common_content_hash: None,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            }],
            active_vault_store_id: None,
        }
    }

    #[test]
    fn seal_and_open_github_pat_round_trips() {
        let identity = DeviceIdentity::generate().unwrap();
        let pat = "github_pat_11AAAAbbbbCCCC";
        let mut snapshot = github_snapshot(pat);
        seal_provider_credentials(&identity, &mut snapshot).unwrap();
        let stored = snapshot.providers[0].github_pat.as_ref().unwrap();
        assert!(is_sealed_credential(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        assert!(!open_provider_credentials(&identity, &mut opened).unwrap());
        assert_eq!(opened.providers[0].github_pat.as_deref(), Some(pat));
    }

    #[test]
    fn seal_and_open_oauth_tokens_round_trips() {
        let identity = DeviceIdentity::generate().unwrap();
        let access = "ya29.oauth-access-token";
        let refresh = "1//refresh-token-secret";
        let mut snapshot = oauth_snapshot(access, Some(refresh));
        seal_provider_credentials(&identity, &mut snapshot).unwrap();
        let oauth = snapshot.providers[0].oauth_file.as_ref().unwrap();
        assert!(is_sealed_credential(&oauth.access_token));
        assert!(
            oauth
                .refresh_token
                .as_ref()
                .is_some_and(|value| is_sealed_credential(value))
        );
        assert!(!oauth.access_token.contains(access));
        assert!(!oauth.refresh_token.as_ref().unwrap().contains(refresh));

        let mut opened = snapshot;
        assert!(!open_provider_credentials(&identity, &mut opened).unwrap());
        let opened_oauth = opened.providers[0].oauth_file.as_ref().unwrap();
        assert_eq!(opened_oauth.access_token, access);
        assert_eq!(opened_oauth.refresh_token.as_deref(), Some(refresh));
    }

    #[test]
    fn open_reports_legacy_plaintext_without_decrypting() {
        let identity = DeviceIdentity::generate().unwrap();
        let pat = "github_pat_11LEGACY";
        let mut snapshot = github_snapshot(pat);
        assert!(open_provider_credentials(&identity, &mut snapshot).unwrap());
        assert_eq!(snapshot.providers[0].github_pat.as_deref(), Some(pat));
    }

    #[test]
    fn seal_is_idempotent_for_already_sealed_fields() {
        let identity = DeviceIdentity::generate().unwrap();
        let mut snapshot = github_snapshot("github_pat_11AAAA");
        seal_provider_credentials(&identity, &mut snapshot).unwrap();
        let sealed_once = snapshot.providers[0].github_pat.clone();
        seal_provider_credentials(&identity, &mut snapshot).unwrap();
        assert_eq!(snapshot.providers[0].github_pat, sealed_once);
    }

    #[test]
    fn sealed_credentials_fail_on_wrong_device() {
        let owner = DeviceIdentity::generate().unwrap();
        let other = DeviceIdentity::generate().unwrap();
        let mut snapshot = github_snapshot("github_pat_11SECRET");
        seal_provider_credentials(&owner, &mut snapshot).unwrap();
        assert!(open_provider_credentials(&other, &mut snapshot).is_err());
    }

    #[test]
    fn seal_for_public_key_opens_on_recipient_device() {
        let extension = DeviceIdentity::generate().unwrap();
        let pat = "github_pat_11EXTENSIONgrant";
        let mut snapshot = github_snapshot(pat);
        seal_provider_credentials_for_public_key(&extension.public_key(), &mut snapshot).unwrap();
        let stored = snapshot.providers[0].github_pat.as_ref().unwrap();
        assert!(is_sealed_credential(stored));
        assert!(!stored.contains(pat));

        let mut opened = snapshot;
        assert!(!open_provider_credentials(&extension, &mut opened).unwrap());
        assert_eq!(opened.providers[0].github_pat.as_deref(), Some(pat));
    }
}
