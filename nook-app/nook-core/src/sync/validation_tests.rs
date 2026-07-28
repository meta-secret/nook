use super::*;
use crate::{
    ApiKeySecret, SecretRecord, SecretType, SecretValue, validate_secret_id, validate_store_id,
};

fn value(key: &str) -> SecretValue {
    SecretValue::ApiKey(ApiKeySecret {
        website_url: "https://example.com".to_owned(),
        key: key.to_owned(),
        expires_at: String::new(),
    })
}

fn sample_records() -> anyhow::Result<Vec<SecretRecord>> {
    Ok(vec![
        SecretRecord {
            id: validate_secret_id("secret_SMypl8K0w9Y")?,
            secret_type: SecretType::ApiKey,
            data: value("a"),
        },
        SecretRecord {
            id: validate_secret_id("secret_SMypl8K0w9Z")?,
            secret_type: SecretType::ApiKey,
            data: value("b"),
        },
    ])
}

#[test]
fn validate_github_repo_name_defaults_and_rejects_invalid() -> anyhow::Result<()> {
    assert_eq!(
        validate_github_repo_name("  ")?.as_str(),
        DEFAULT_GITHUB_REPO_NAME
    );
    assert_eq!(
        validate_github_repo_name("work-vault")?.as_str(),
        "work-vault"
    );
    assert!(validate_github_repo_name(".").is_err());
    assert!(validate_github_repo_name("bad name").is_err());
    Ok(())
}

#[test]
fn validate_connect_github_requires_pat() -> anyhow::Result<()> {
    assert!(validate_connect(STORAGE_MODE_GITHUB, "  ").is_err());
    assert_eq!(
        validate_connect(STORAGE_MODE_GITHUB, " ghp_test ")?
            .ok_or_else(|| std::io::Error::other("GitHub credential must be returned"))?
            .as_str(),
        "ghp_test"
    );
    Ok(())
}

#[test]
fn validate_connect_local_ok() -> anyhow::Result<()> {
    assert_eq!(validate_connect(STORAGE_MODE_LOCAL, "")?, None);
    Ok(())
}

#[test]
fn storage_mode_for_provider_maps_oauth_presets() -> anyhow::Result<()> {
    assert_eq!(
        storage_mode_for_provider(StorageProviderType::Local, None),
        StorageMode::Local
    );
    assert_eq!(
        storage_mode_for_provider(StorageProviderType::LocalFolder, None),
        StorageMode::Local
    );
    assert_eq!(
        storage_mode_for_provider(StorageProviderType::Github, None),
        StorageMode::Github
    );
    assert_eq!(
        storage_mode_for_provider(StorageProviderType::OauthFile, None),
        StorageMode::GoogleDrive
    );
    assert_eq!(
        storage_mode_for_provider(
            StorageProviderType::OauthFile,
            Some(OauthFilePreset::ICloud)
        ),
        StorageMode::ICloud
    );
    Ok(())
}

#[test]
fn provider_default_labels_match_sync_provider_ui() -> anyhow::Result<()> {
    assert_eq!(
        sync_provider_default_label(StorageProviderType::Local, None, None),
        "This device"
    );
    assert_eq!(
        sync_provider_default_label(StorageProviderType::LocalFolder, Some("Nook Backup"), None,),
        "Local backup · Nook Backup"
    );
    assert_eq!(
        sync_provider_default_label(StorageProviderType::Github, Some("team-vault"), None),
        "GitHub · team-vault"
    );
    assert_eq!(
        sync_provider_default_label(StorageProviderType::OauthFile, None, None),
        "Google Drive"
    );
    assert_eq!(
        sync_provider_default_label(
            StorageProviderType::OauthFile,
            Some("work.yaml"),
            Some(OauthFilePreset::ICloud),
        ),
        "iCloud · work.yaml"
    );
    Ok(())
}

#[test]
fn staged_provider_labels_match_login_setup_draft_fields() -> anyhow::Result<()> {
    assert_eq!(
        staged_provider_default_label(
            StorageProviderType::Github,
            Some("  team-vault  "),
            None,
            None,
            None,
        ),
        "GitHub · team-vault"
    );
    assert_eq!(
        staged_provider_default_label(StorageProviderType::Github, Some("  "), None, None, None),
        "GitHub"
    );
    assert_eq!(
        staged_provider_default_label(
            StorageProviderType::OauthFile,
            Some("drive-vault"),
            Some("ignored-file"),
            None,
            Some(OauthFilePreset::ICloud),
        ),
        "iCloud · drive-vault"
    );
    assert_eq!(
        staged_provider_default_label(
            StorageProviderType::OauthFile,
            Some("  "),
            Some(" personal-events "),
            Some(OauthFilePreset::GoogleDrive),
            Some(OauthFilePreset::ICloud),
        ),
        "Google Drive · personal-events"
    );
    assert_eq!(
        staged_provider_default_label(
            StorageProviderType::LocalFolder,
            Some("ignored"),
            Some("ignored"),
            None,
            None,
        ),
        "Local backup"
    );
    Ok(())
}

#[test]
fn provider_credentials_match_provider_requirements() -> anyhow::Result<()> {
    assert!(has_provider_credentials(
        StorageProviderType::Local,
        None,
        None,
        None,
    ));
    assert!(has_provider_credentials(
        StorageProviderType::Github,
        Some(" ghp_test "),
        None,
        None,
    ));
    assert!(!has_provider_credentials(
        StorageProviderType::Github,
        Some(" "),
        None,
        None,
    ));
    assert!(has_provider_credentials(
        StorageProviderType::OauthFile,
        None,
        Some(" token "),
        None,
    ));
    assert!(!has_provider_credentials(
        StorageProviderType::OauthFile,
        None,
        None,
        None,
    ));
    assert!(has_provider_credentials(
        StorageProviderType::LocalFolder,
        None,
        None,
        Some(" folder-1 "),
    ));
    assert!(!has_provider_credentials(
        StorageProviderType::LocalFolder,
        None,
        None,
        Some(" "),
    ));
    Ok(())
}

#[test]
fn mask_github_pat_named_states() -> anyhow::Result<()> {
    assert_eq!(mask_github_pat("   "), GithubPatMask::NoToken);
    assert_eq!(mask_github_pat(""), GithubPatMask::NoToken);
    assert_eq!(
        mask_github_pat("github_pat_11AAAAAAAAAA"),
        GithubPatMask::Hint("github_pat_11A…".to_owned())
    );
    assert_eq!(
        mask_github_pat("ghp_1234567890ABCDEF"),
        GithubPatMask::Hint("ghp_123456…".to_owned())
    );
    assert_eq!(
        mask_github_pat("ghp_short"),
        GithubPatMask::Hint("••••".to_owned())
    );
    Ok(())
}

#[test]
fn sync_provider_target_key_matches_duplicates_by_storage_identity() -> anyhow::Result<()> {
    let github_a = SyncProviderTarget::Github(GithubSyncTarget {
        repo: "My-Repo".to_owned(),
        pat: "github_pat_11AAAA".to_owned(),
    });
    let github_b = SyncProviderTarget::Github(GithubSyncTarget {
        repo: "my-repo".to_owned(),
        pat: "github_pat_11AAAA".to_owned(),
    });
    assert_eq!(
        sync_provider_target_key(&github_a),
        sync_provider_target_key(&github_b)
    );

    let drive_by_id = SyncProviderTarget::OauthFile(OauthFileSyncTarget {
        preset: OauthFilePreset::GoogleDrive,
        file_id: Some("file-123".to_owned()),
        folder_id: None,
        file_name: Some("other-name.yaml".to_owned()),
        account_email: Some("me@example.com".to_owned()),
        access_token: Some("ya29.test".to_owned()),
    });
    let drive_by_name = SyncProviderTarget::OauthFile(OauthFileSyncTarget {
        preset: OauthFilePreset::GoogleDrive,
        file_id: None,
        folder_id: None,
        file_name: Some("other-name.yaml".to_owned()),
        account_email: Some("me@example.com".to_owned()),
        access_token: Some("ya29.test".to_owned()),
    });
    assert_ne!(
        sync_provider_target_key(&drive_by_id),
        sync_provider_target_key(&drive_by_name)
    );

    let folder = SyncProviderTarget::LocalFolder(LocalFolderSyncTarget {
        directory_name: Some("Nook Backup".to_owned()),
        handle_id: Some("folder-1".to_owned()),
    });
    assert_eq!(
        sync_provider_target_key(&folder),
        Some("local-folder:folder-1".to_owned())
    );

    assert_eq!(sync_provider_target_key(&SyncProviderTarget::Empty), None);
    Ok(())
}

#[test]
fn validate_secret_fields() -> anyhow::Result<()> {
    assert!(validate_secret_id("  ").is_err());
    assert_eq!(
        validate_secret_id(" secret_SMypl8K0w9Y ")?.as_str(),
        "secret_SMypl8K0w9Y"
    );
    assert!(validate_secret_data("").is_err());
    assert!(validate_secret_data("x").is_ok());
    assert!(validate_secret_id("abc123def4567890").is_err());
    assert!(validate_secret_id(&"a".repeat(64)).is_err());
    assert_eq!(
        validate_store_id("store_SMypl8K0w9Y")?.as_str(),
        "store_SMypl8K0w9Y"
    );
    assert_eq!(
        validate_store_id("SMypl8K0w9Y")?.as_str(),
        "store_SMypl8K0w9Y"
    );
    assert!(validate_store_id("short").is_err());
    assert_eq!(
        validate_secret_id("secret_SMypl8K0w9Y")?.as_str(),
        "secret_SMypl8K0w9Y"
    );
    Ok(())
}

#[test]
fn filter_secrets_case_insensitive() -> anyhow::Result<()> {
    let filtered = filter_secrets(&sample_records()?, "W9Y");
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].id.as_str(), "secret_SMypl8K0w9Y");
    Ok(())
}

#[test]
fn filter_secrets_empty_query_returns_all() -> anyhow::Result<()> {
    assert_eq!(filter_secrets(&sample_records()?, "  ").len(), 2);
    Ok(())
}

#[test]
fn validate_storage_mode_rejects_unknown() -> anyhow::Result<()> {
    assert!(validate_storage_mode("s3").is_err());
    Ok(())
}

#[test]
fn storage_mode_roundtrips_through_string_tag() -> anyhow::Result<()> {
    assert_eq!(StorageMode::Local.as_str(), "local");
    assert_eq!(StorageMode::Github.as_str(), "github");
    assert_eq!(StorageMode::GoogleDrive.as_str(), "google-drive");
    assert_eq!(StorageMode::ICloud.as_str(), "icloud");
    assert_eq!(StorageMode::parse("local")?, StorageMode::Local);
    assert_eq!(StorageMode::parse("github")?, StorageMode::Github);
    assert_eq!(
        StorageMode::parse("google-drive")?,
        StorageMode::GoogleDrive
    );
    assert_eq!(StorageMode::parse("icloud")?, StorageMode::ICloud);
    assert!(StorageMode::parse("s3").is_err());
    assert_eq!(format!("{}", StorageMode::Local), "local");
    Ok(())
}

#[test]
fn storage_mode_consts_match_enum() -> anyhow::Result<()> {
    assert_eq!(STORAGE_MODE_LOCAL, StorageMode::Local.as_str());
    assert_eq!(STORAGE_MODE_GITHUB, StorageMode::Github.as_str());
    Ok(())
}

#[test]
fn validate_connect_icloud_requires_access_token() -> anyhow::Result<()> {
    assert!(validate_connect("icloud", "  ").is_err());
    assert_eq!(validate_connect("icloud", " ck-web-token ")?, None);
    Ok(())
}

#[test]
fn validate_connect_google_drive_requires_access_token() -> anyhow::Result<()> {
    assert!(validate_connect("google-drive", "  ").is_err());
    assert_eq!(validate_connect("google-drive", " ya29.test ")?, None);
    Ok(())
}

#[test]
fn validate_drive_backup_name_defaults_and_rejects_invalid() -> anyhow::Result<()> {
    assert_eq!(
        validate_drive_backup_name("  ")?.as_str(),
        DEFAULT_DRIVE_BACKUP_NAME
    );
    assert_eq!(
        validate_drive_backup_name("work-vault.yaml")?.as_str(),
        "work-vault.yaml"
    );
    assert!(validate_drive_backup_name(".").is_err());
    assert!(validate_drive_backup_name("bad name").is_err());
    Ok(())
}

#[test]
fn parse_drive_storage_ref_splits_file_id_and_name() -> anyhow::Result<()> {
    assert_eq!(
        parse_drive_storage_ref("abc123\twork-vault.yaml")?,
        (
            "abc123".to_owned(),
            validate_drive_backup_name("work-vault.yaml")?
        )
    );
    assert_eq!(
        parse_drive_storage_ref("nook-events")?,
        (String::new(), validate_drive_backup_name("nook-events")?)
    );
    Ok(())
}

#[test]
fn format_drive_storage_ref_omits_empty_file_id() -> anyhow::Result<()> {
    assert_eq!(
        format_drive_storage_ref("", &validate_drive_backup_name("nook-events")?),
        "nook-events"
    );
    assert_eq!(
        format_drive_storage_ref("abc", &validate_drive_backup_name("work.yaml")?),
        "abc\twork.yaml"
    );
    Ok(())
}

#[test]
fn format_drive_storage_ref_raw_does_not_validate_file_name() -> anyhow::Result<()> {
    assert_eq!(
        format_drive_storage_ref_raw(" abc ", " work vault.yaml "),
        "abc\twork vault.yaml"
    );
    Ok(())
}

#[test]
fn validate_oauth_access_token_rejects_empty() -> anyhow::Result<()> {
    assert!(validate_oauth_access_token(" ").is_err());
    assert_eq!(validate_oauth_access_token(" token ")?.as_str(), "token");
    Ok(())
}

#[test]
fn filter_secrets_no_match_returns_empty() -> anyhow::Result<()> {
    assert!(filter_secrets(&sample_records()?, "aws").is_empty());
    Ok(())
}

#[test]
fn filter_secrets_matches_substring_in_id() -> anyhow::Result<()> {
    let filtered = filter_secrets(&sample_records()?, "K0w9Y");
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].id.as_str(), "secret_SMypl8K0w9Y");
    Ok(())
}

#[test]
fn validate_secret_data_allows_whitespace() -> anyhow::Result<()> {
    assert!(validate_secret_data("   ").is_ok());
    Ok(())
}

#[test]
fn filter_secrets_does_not_search_values() -> anyhow::Result<()> {
    let records = vec![SecretRecord {
        id: validate_secret_id("secret_SMypl8K0w9X")?,
        secret_type: SecretType::ApiKey,
        data: value("find-me"),
    }];
    assert!(filter_secrets(&records, "find-me").is_empty());
    Ok(())
}

#[test]
fn sync_provider_cache_ref_is_stable() -> anyhow::Result<()> {
    assert_eq!(
        format_sync_provider_cache_ref(StorageMode::Local, "", ""),
        "local"
    );
    assert_eq!(
        format_sync_provider_cache_ref(StorageMode::Github, "user/repo", "nook-log/v1/events"),
        "github:user/repo:nook-log/v1/events"
    );
    assert_eq!(
        format_sync_provider_cache_ref(StorageMode::GoogleDrive, "file-id", ""),
        "drive:file-id"
    );
    Ok(())
}

#[test]
fn drive_event_parent_parses_shared_folder_prefix() -> anyhow::Result<()> {
    assert_eq!(
        DriveEventParent::from_storage_id(""),
        DriveEventParent::AppDataFolder
    );
    assert_eq!(
        DriveEventParent::from_storage_id("legacy-file-id"),
        DriveEventParent::AppDataFolder
    );
    assert_eq!(
        DriveEventParent::from_storage_id("shared:folder-xyz"),
        DriveEventParent::SharedFolder {
            folder_id: "folder-xyz".to_owned(),
        }
    );
    assert_eq!(
        DriveEventParent::SharedFolder {
            folder_id: "folder-xyz".to_owned(),
        }
        .encode_storage_id(),
        "shared:folder-xyz"
    );
    Ok(())
}

#[test]
fn google_drive_mode_requires_an_explicit_current_value() -> anyhow::Result<()> {
    assert_eq!(GoogleDriveMode::parse("private")?, GoogleDriveMode::Private);
    assert_eq!(GoogleDriveMode::parse("shared")?, GoogleDriveMode::Shared);
    assert!(GoogleDriveMode::parse("").is_err());
    assert!(GoogleDriveMode::parse("public").is_err());
    Ok(())
}

#[test]
fn icloud_shared_target_roundtrips_without_credentials() -> anyhow::Result<()> {
    let owner = ICloudSharedTarget::new(
        ICloudShareRole::Owner,
        "nook-zone",
        "owner-record",
        "root-record",
        "short-guid",
    )?;
    let storage_id = owner.to_storage_id()?;
    assert!(storage_id.starts_with("icloud-share-v1:"));
    assert_eq!(ICloudSharedTarget::from_storage_id(&storage_id)?, owner);
    assert_eq!(
        ICloudEventTarget::from_storage_id("")?,
        ICloudEventTarget::Private
    );
    assert_eq!(
        ICloudEventTarget::from_storage_id("nook-events")?,
        ICloudEventTarget::Private
    );
    assert_eq!(
        ICloudEventTarget::from_storage_id("legacy-private-record-ref")?,
        ICloudEventTarget::Private
    );
    assert_eq!(
        ICloudEventTarget::from_storage_id(&storage_id)?,
        ICloudEventTarget::Shared(owner)
    );
    assert!(ICloudEventTarget::from_storage_id("icloud-share-v1:{}").is_err());
    assert!(ICloudSharedTarget::from_storage_id("icloud-share-v1:{}").is_err());
    Ok(())
}

#[test]
fn icloud_mode_requires_an_explicit_current_value() -> anyhow::Result<()> {
    assert_eq!(ICloudMode::parse("private")?, ICloudMode::Private);
    assert_eq!(ICloudMode::parse("shared")?, ICloudMode::Shared);
    assert!(ICloudMode::parse("").is_err());
    assert!(ICloudMode::parse("public").is_err());
    Ok(())
}

#[test]
fn normalize_google_drive_folder_ref_accepts_id_and_folder_url() -> anyhow::Result<()> {
    assert_eq!(
        normalize_google_drive_folder_ref(" folder_ABC-123 ")?.as_str(),
        "folder_ABC-123"
    );
    assert_eq!(
        normalize_google_drive_folder_ref(
            "https://drive.google.com/drive/u/1/folders/folder_ABC-123?resourcekey=key"
        )?
        .as_str(),
        "folder_ABC-123"
    );
    assert!(normalize_google_drive_folder_ref("https://example.com/not-a-folder").is_err());
    Ok(())
}
