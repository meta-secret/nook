use super::*;
use serde_json::json;

fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
    StorageProviderData {
        id: id.to_owned(),
        provider_type: "github".to_owned(),
        label: "GitHub".to_owned(),
        github_pat: Some(pat.to_owned()),
        github_repo: Some(repo.to_owned()),
        oauth_file: None,
        local_folder: None,
        store_id: None,
        sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
        created_at: "2026-06-24T00:00:00.000Z".to_owned(),
    }
}

fn local_folder_provider(id: &str, handle_id: &str) -> StorageProviderData {
    StorageProviderData {
        id: id.to_owned(),
        provider_type: "local-folder".to_owned(),
        label: "Local backup".to_owned(),
        github_pat: None,
        github_repo: None,
        oauth_file: None,
        local_folder: Some(LocalFolderConfigData {
            directory_name: Some("Nook Backup".to_owned()),
            handle_id: Some(handle_id.to_owned()),
        }),
        store_id: None,
        sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
        created_at: "2026-06-24T00:00:00.000Z".to_owned(),
    }
}

fn oauth_provider(
    id: &str,
    preset: OauthFilePreset,
    file_id: Option<&str>,
    file_name: &str,
) -> StorageProviderData {
    StorageProviderData {
        id: id.to_owned(),
        provider_type: "oauth-file".to_owned(),
        label: "Google Drive".to_owned(),
        github_pat: None,
        github_repo: None,
        oauth_file: Some(OAuthFileConfigData {
            preset,
            access_token: " token ".to_owned(),
            file_id: file_id.map(str::to_owned),
            file_name: Some(file_name.to_owned()),
            ..OAuthFileConfigData::default()
        }),
        local_folder: None,
        store_id: None,
        sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
        created_at: "2026-06-24T00:00:00.000Z".to_owned(),
    }
}

fn detail_labels() -> ProviderStorageDetailLabels {
    ProviderStorageDetailLabels {
        this_device_desc: "This device desc".to_owned(),
        no_token_saved: "No token saved".to_owned(),
        google_signed_in: "Signed in with Google".to_owned(),
        icloud_signed_in: "Signed in with iCloud".to_owned(),
        google_not_signed_in: "Not signed in".to_owned(),
        icloud_not_signed_in: "Not signed in with iCloud".to_owned(),
        local_folder_needs_reconnect: "Choose folder".to_owned(),
    }
}

fn provider_label_labels() -> ProviderLabelLabels {
    ProviderLabelLabels {
        this_device: "This device localized".to_owned(),
        github: "GitHub localized".to_owned(),
        local_folder: "Local folder localized".to_owned(),
        google_drive: "Google Drive localized".to_owned(),
        icloud: "iCloud localized".to_owned(),
    }
}

#[test]
fn normalize_handles_missing_value() -> anyhow::Result<()> {
    let result = normalize_auth_snapshot(&serde_json::Value::Null);
    assert_eq!(result.snapshot, AuthProvidersSnapshotData::default());
    assert!(!result.changed);
    Ok(())
}

#[test]
fn normalize_keeps_active_vault_store_id() -> anyhow::Result<()> {
    let raw = json!({ "providers": [], "activeVaultStoreId": "vault-1" });
    let result = normalize_auth_snapshot(&raw);
    assert_eq!(
        result.snapshot.active_vault_store_id.as_deref(),
        Some("vault-1")
    );
    assert!(!result.changed);
    Ok(())
}

#[test]
fn find_duplicate_matches_github_repo_and_pat() -> anyhow::Result<()> {
    let existing = github_provider("gh-existing", "nook-crdt-test-1", "github_pat_11AAAA");
    let candidate = github_provider("gh-new", "nook-crdt-test-1", "github_pat_11AAAA");
    let found = find_duplicate_sync_provider(&[existing], &candidate, None);
    assert_eq!(
        found.map(|provider| provider.id).as_deref(),
        Some("gh-existing")
    );
    Ok(())
}

#[test]
fn github_without_pat_has_no_stable_sync_identity() -> anyhow::Result<()> {
    let provider = StorageProviderData {
        github_pat: None,
        ..github_provider("gh-draft", "nook", "github_pat_11AAAA")
    };
    assert_eq!(provider_target_key(&provider), None);
    Ok(())
}

#[test]
fn find_duplicate_ignores_excluded_id() -> anyhow::Result<()> {
    let existing = github_provider("gh-self", "nook", "github_pat_11AAAA");
    let found =
        find_duplicate_sync_provider(std::slice::from_ref(&existing), &existing, Some("gh-self"));
    assert!(found.is_none());
    Ok(())
}

#[test]
fn find_duplicate_returns_none_when_distinct() -> anyhow::Result<()> {
    let existing = github_provider("gh-a", "alpha", "github_pat_11AAAA");
    let candidate = github_provider("gh-b", "beta", "github_pat_11AAAA");
    assert!(find_duplicate_sync_provider(&[existing], &candidate, None).is_none());
    Ok(())
}

#[test]
fn find_duplicate_matches_local_folder_handle() -> anyhow::Result<()> {
    let existing = local_folder_provider("folder-a", "handle-1");
    let candidate = local_folder_provider("folder-b", "handle-1");
    let found = find_duplicate_sync_provider(&[existing], &candidate, None);
    assert_eq!(
        found.map(|provider| provider.id).as_deref(),
        Some("folder-a")
    );
    Ok(())
}

#[test]
fn oauth_target_identity_keeps_private_and_shared_drive_rows_distinct() -> anyhow::Result<()> {
    let mut private = oauth_provider(
        "drive-private",
        OauthFilePreset::GoogleDrive,
        None,
        "events",
    );
    private
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
        .drive_mode = GoogleDriveMode::Private;
    let mut shared = oauth_provider("drive-shared", OauthFilePreset::GoogleDrive, None, "events");
    let shared_oauth = shared
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
    shared_oauth.drive_mode = GoogleDriveMode::Shared;
    shared_oauth.folder_id = Some("folder-team".to_owned());

    let providers = vec![private.clone(), shared.clone()];
    assert_eq!(
        find_duplicate_sync_provider(&providers, &private, None)
            .map(|provider| provider.id)
            .as_deref(),
        Some("drive-private")
    );
    assert_eq!(
        find_duplicate_sync_provider(&providers, &shared, None)
            .map(|provider| provider.id)
            .as_deref(),
        Some("drive-shared")
    );
    Ok(())
}

#[test]
fn storage_args_for_configured_provider_rows_match_wasm_connect_contract() -> anyhow::Result<()> {
    assert_eq!(
        storage_args_for_provider(&github_provider("gh", " team-vault ", " pat "))?,
        StorageConnectArgs {
            mode: "github".to_owned(),
            pat: "pat".to_owned(),
            repo: "team-vault".to_owned(),
        }
    );
    assert_eq!(
        storage_args_for_provider(&oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive,
            Some(" file-1 "),
            " events "
        ))?,
        StorageConnectArgs {
            mode: "google-drive".to_owned(),
            pat: "token".to_owned(),
            repo: "file-1\tevents".to_owned(),
        }
    );
    assert_eq!(
        storage_args_for_provider(&local_folder_provider("folder", "handle-1"))?,
        StorageConnectArgs::local()
    );
    Ok(())
}

#[test]
fn google_drive_mode_switch_clears_scope_bound_credentials_and_targets() -> anyhow::Result<()> {
    let config = OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        access_token: "appdata-token".to_owned(),
        refresh_token: Some("refresh".to_owned()),
        expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
        file_id: Some("appdata-file".to_owned()),
        file_name: Some("nook-events".to_owned()),
        account_email: Some("owner@example.com".to_owned()),
        drive_mode: GoogleDriveMode::Private,
        folder_id: None,
        icloud_mode: ICloudMode::Private,
        icloud_share_target: None,
    };
    let switched = set_google_drive_provider_mode(&config, GoogleDriveMode::Shared);
    assert_eq!(switched.drive_mode, GoogleDriveMode::Shared);
    assert!(switched.access_token.is_empty());
    assert_eq!(switched.refresh_token, None);
    assert_eq!(switched.expires_at, None);
    assert_eq!(switched.account_email, None);
    assert_eq!(switched.file_id, None);
    assert_eq!(switched.folder_id, None);
    assert_eq!(switched.file_name.as_deref(), Some("nook-events"));
    Ok(())
}

#[test]
fn oauth_token_merges_preserve_only_same_provider_targets() -> anyhow::Result<()> {
    let google_existing = OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        access_token: "old".to_owned(),
        refresh_token: Some("refresh".to_owned()),
        expires_at: Some("old-expiry".to_owned()),
        file_id: Some("file".to_owned()),
        file_name: Some("events".to_owned()),
        account_email: Some("alex@example.com".to_owned()),
        drive_mode: GoogleDriveMode::Shared,
        folder_id: Some("folder".to_owned()),
        ..OAuthFileConfigData::default()
    };
    let google = google_oauth_tokens_to_config(
        "new-google-token",
        "2026-07-20T00:00:00Z",
        Some(&google_existing),
    );
    assert_eq!(google.access_token, "new-google-token");
    assert_eq!(google.expires_at.as_deref(), Some("2026-07-20T00:00:00Z"));
    assert_eq!(google.drive_mode, GoogleDriveMode::Shared);
    assert_eq!(google.folder_id.as_deref(), Some("folder"));
    assert_eq!(google.icloud_mode, ICloudMode::Private);

    let icloud_existing = OAuthFileConfigData {
        preset: OauthFilePreset::ICloud,
        access_token: "old".to_owned(),
        refresh_token: Some("refresh".to_owned()),
        expires_at: Some("unchanged-expiry".to_owned()),
        file_id: Some("record".to_owned()),
        file_name: Some("events".to_owned()),
        account_email: Some("old@example.com".to_owned()),
        icloud_mode: ICloudMode::Shared,
        icloud_share_target: Some("icloud-share-v1:{\"role\":\"owner\"}".to_owned()),
        ..OAuthFileConfigData::default()
    };
    let icloud = icloud_oauth_tokens_to_config(
        "new-icloud-token",
        Some("new@example.com"),
        Some(&icloud_existing),
    );
    assert_eq!(icloud.access_token, "new-icloud-token");
    assert_eq!(icloud.account_email.as_deref(), Some("new@example.com"));
    assert_eq!(icloud.icloud_mode, ICloudMode::Shared);
    assert_eq!(
        icloud.icloud_share_target,
        icloud_existing.icloud_share_target
    );
    assert_eq!(icloud.drive_mode, GoogleDriveMode::Private);
    assert!(icloud.folder_id.is_none());
    Ok(())
}

#[test]
fn binding_shared_drive_folder_preserves_credentials_and_internal_event_name() -> anyhow::Result<()>
{
    let config = OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        access_token: "shared-token".to_owned(),
        refresh_token: Some("refresh".to_owned()),
        expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
        file_id: Some("stale-appdata-file".to_owned()),
        file_name: Some("nook-events".to_owned()),
        account_email: Some("owner@example.com".to_owned()),
        drive_mode: GoogleDriveMode::Private,
        folder_id: None,
        icloud_mode: ICloudMode::Private,
        icloud_share_target: None,
    };

    let bound = bind_google_drive_shared_folder(
        &config,
        "https://drive.google.com/drive/folders/folder-team",
    )?;

    assert_eq!(bound.drive_mode, GoogleDriveMode::Shared);
    assert_eq!(bound.folder_id.as_deref(), Some("folder-team"));
    assert_eq!(bound.file_id, None);
    assert_eq!(bound.access_token, "shared-token");
    assert_eq!(bound.refresh_token.as_deref(), Some("refresh"));
    assert_eq!(bound.file_name.as_deref(), Some("nook-events"));

    let mut provider = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "nook-events");
    provider.oauth_file = Some(bound);
    assert_eq!(
        storage_args_for_provider(&provider)?.repo,
        "shared:folder-team\tnook-events"
    );
    Ok(())
}

#[test]
fn storage_args_require_folder_for_explicit_shared_drive_mode() -> anyhow::Result<()> {
    let mut provider = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events");
    provider
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
        .drive_mode = GoogleDriveMode::Shared;
    assert_eq!(
        storage_args_for_provider(&provider),
        Err(ValidationError::SharedStorageTargetRequired)
    );
    provider
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
        .folder_id = Some("folder-1".to_owned());
    assert_eq!(
        storage_args_for_provider(&provider)?.repo,
        "shared:folder-1\tevents"
    );
    Ok(())
}

#[test]
fn provider_storage_detail_matches_provider_rows() -> anyhow::Result<()> {
    let labels = detail_labels();
    assert_eq!(
        provider_storage_detail(
            &StorageProviderData {
                id: "local".to_owned(),
                provider_type: "local".to_owned(),
                label: "This device".to_owned(),
                github_pat: None,
                github_repo: None,
                oauth_file: None,
                local_folder: None,
                store_id: None,
                sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-06-24T00:00:00.000Z".to_owned(),
            },
            &labels,
        )?,
        "This device desc"
    );
    assert_eq!(
        provider_storage_detail(
            &github_provider("gh", " team-vault ", " github_pat_11AAAAbbbbCCCC "),
            &labels,
        )?,
        "team-vault · github_pat_11A…"
    );
    assert_eq!(
        provider_storage_detail(
            &StorageProviderData {
                github_pat: Some(" ".to_owned()),
                github_repo: Some(" ".to_owned()),
                ..github_provider("gh", "team-vault", "github_pat_11AAAAbbbbCCCC")
            },
            &labels,
        )?,
        "nook · No token saved"
    );
    assert_eq!(
        provider_storage_detail(&local_folder_provider("folder", "handle-1"), &labels)?,
        "Nook Backup"
    );
    assert_eq!(
        provider_storage_detail(
            &StorageProviderData {
                local_folder: None,
                ..local_folder_provider("folder", "handle-1")
            },
            &labels,
        )?,
        "Choose folder"
    );
    assert_eq!(
        provider_storage_detail(
            &StorageProviderData {
                oauth_file: Some(OAuthFileConfigData {
                    account_email: Some("person@example.com".to_owned()),
                    ..oauth_provider("drive", OauthFilePreset::GoogleDrive, None, " events ")
                        .oauth_file
                        .ok_or_else(|| std::io::Error::other("OAuth provider file must exist"))?
                }),
                ..oauth_provider("drive", OauthFilePreset::GoogleDrive, None, " events ")
            },
            &labels,
        )?,
        "events · person@example.com"
    );
    assert_eq!(
        provider_storage_detail(
            &oauth_provider("icloud", OauthFilePreset::ICloud, None, " "),
            &labels
        )?,
        format!("{DEFAULT_DRIVE_BACKUP_NAME} · Signed in with iCloud")
    );
    Ok(())
}

#[test]
fn localize_provider_label_preserves_provider_detail_suffixes() -> anyhow::Result<()> {
    let labels = provider_label_labels();
    assert_eq!(
        localize_provider_label("This device", &labels),
        "This device localized"
    );
    assert_eq!(
        localize_provider_label("GitHub", &labels),
        "GitHub localized"
    );
    assert_eq!(
        localize_provider_label("GitHub · team-vault", &labels),
        "GitHub localized · team-vault"
    );
    assert_eq!(
        localize_provider_label("Local backup · Nook Backup", &labels),
        "Local folder localized · Nook Backup"
    );
    assert_eq!(
        localize_provider_label("Google Drive · work.yaml", &labels),
        "Google Drive localized · work.yaml"
    );
    assert_eq!(
        localize_provider_label("iCloud · home.yaml", &labels),
        "iCloud localized · home.yaml"
    );
    assert_eq!(
        localize_provider_label("Custom provider", &labels),
        "Custom provider"
    );
    Ok(())
}

#[test]
fn draft_storage_args_select_provider_specific_fields() -> anyhow::Result<()> {
    assert_eq!(
        draft_storage_args(
            StorageProviderType::Local,
            Some("draft-pat"),
            Some("draft-repo"),
            None,
            None,
            None,
            None,
        ),
        StorageConnectArgs {
            mode: "local".to_owned(),
            pat: "draft-pat".to_owned(),
            repo: "draft-repo".to_owned(),
        }
    );
    assert_eq!(
        draft_storage_args(
            StorageProviderType::OauthFile,
            None,
            Some(" repo-fallback "),
            Some(OauthFilePreset::ICloud),
            Some(" token "),
            Some(" file-id "),
            Some(" "),
        ),
        StorageConnectArgs {
            mode: "icloud".to_owned(),
            pat: "token".to_owned(),
            repo: "file-id\trepo-fallback".to_owned(),
        }
    );
    Ok(())
}

#[test]
fn vault_storage_args_prefers_local_cache_then_authenticated_provider() -> anyhow::Result<()> {
    let provider = github_provider("gh", "team-vault", "pat");
    assert_eq!(
        vault_storage_args(
            true,
            true,
            Some(&provider),
            StorageProviderType::Github,
            Some("draft-pat"),
            Some("draft-repo"),
            None,
            None,
            None,
            None,
        )?,
        StorageConnectArgs::local()
    );
    assert_eq!(
        vault_storage_args(
            false,
            true,
            Some(&provider),
            StorageProviderType::Github,
            Some("draft-pat"),
            Some("draft-repo"),
            None,
            None,
            None,
            None,
        )?,
        StorageConnectArgs {
            mode: "github".to_owned(),
            pat: "pat".to_owned(),
            repo: "team-vault".to_owned(),
        }
    );
    assert_eq!(
        vault_storage_args(
            false,
            false,
            Some(&provider),
            StorageProviderType::Github,
            Some("draft-pat"),
            Some("draft-repo"),
            None,
            None,
            None,
            None,
        )?,
        StorageConnectArgs {
            mode: "github".to_owned(),
            pat: "draft-pat".to_owned(),
            repo: "draft-repo".to_owned(),
        }
    );
    Ok(())
}

#[test]
fn ensure_local_row_added_when_missing() -> anyhow::Result<()> {
    let snapshot = AuthProvidersSnapshotData {
        providers: vec![github_provider("gh", "nook", "pat")],
        active_vault_store_id: None,
    };
    let (next, changed) =
        ensure_local_provider_row(&snapshot, None, "local-1", "2026-06-24T00:00:00.000Z");
    assert!(changed);
    assert_eq!(next.providers.len(), 2);
    assert_eq!(next.providers[0].provider_type, "local");
    assert_eq!(next.providers[0].label, "This device");
    Ok(())
}

#[test]
fn ensure_local_row_noop_when_present() -> anyhow::Result<()> {
    let snapshot = AuthProvidersSnapshotData {
        providers: vec![StorageProviderData {
            id: "local".to_owned(),
            provider_type: "local".to_owned(),
            label: "This device".to_owned(),
            github_pat: None,
            github_repo: None,
            oauth_file: None,
            local_folder: None,
            store_id: Some("vault-1".to_owned()),
            sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }],
        active_vault_store_id: Some("vault-1".to_owned()),
    };
    let (next, changed) = ensure_local_provider_row(&snapshot, Some("vault-1"), "local-2", "x");
    assert!(!changed);
    assert_eq!(next.providers.len(), 1);
    Ok(())
}

#[test]
fn provider_row_replication_capability_matches_provider_preset() -> anyhow::Result<()> {
    let github = github_provider("gh", "nook", "pat");
    assert!(validate_provider_row_replication(&github, ReplicationType::Personal).is_ok());
    assert!(validate_provider_row_replication(&github, ReplicationType::Shared).is_err());

    let gdrive = StorageProviderData {
        id: "gd".to_owned(),
        provider_type: "oauth-file".to_owned(),
        label: "Google Drive".to_owned(),
        github_pat: None,
        github_repo: None,
        oauth_file: Some(OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "tok".to_owned(),
            account_email: Some("joiner@example.com".to_owned()),
            ..OAuthFileConfigData::default()
        }),
        local_folder: None,
        store_id: None,
        sync_checkpoint: crate::ProviderSyncCheckpoint::NeverSynced,
        created_at: "2026-06-24T00:00:00.000Z".to_owned(),
    };
    let capability = validate_provider_row_replication(&gdrive, ReplicationType::Shared)?;
    assert!(capability.supports_shared);
    assert_eq!(
        capability.shared_joiner_identity,
        crate::ProviderJoinerIdentity::Required(crate::SharedJoinerIdentityKind::Email)
    );
    Ok(())
}

#[test]
fn compatible_provider_selection_is_core_owned() -> anyhow::Result<()> {
    let github = github_provider("github", "nook", "github_pat_11AAAA");
    let drive = oauth_provider("drive", OauthFilePreset::GoogleDrive, None, "events");
    let providers = vec![github, drive];

    assert_eq!(
        first_compatible_provider_id(&providers, ReplicationType::Shared, Some("github"))
            .as_deref(),
        Some("drive")
    );
    assert_eq!(
        first_compatible_provider_id(&providers, ReplicationType::Personal, Some("github"))
            .as_deref(),
        Some("github")
    );
    assert!(!provider_supports_replication(
        &providers[0],
        ReplicationType::Shared
    ));
    assert!(provider_supports_replication(
        &providers[1],
        ReplicationType::Shared
    ));
    Ok(())
}

#[test]
fn enrollment_provider_builder_enforces_replication_before_payload_creation() -> anyhow::Result<()>
{
    let shared = VaultArchitecture {
        replication_type: ReplicationType::Shared,
        ..VaultArchitecture::default()
    };
    let github = github_provider("gh", "nook", "github_pat_123");
    assert!(enrollment_provider_for_architecture(&github, &shared, Some("a@b.com")).is_err());

    let gdrive = oauth_provider(
        "drive",
        OauthFilePreset::GoogleDrive,
        Some("file-123"),
        "nook.yaml",
    );
    assert_eq!(
        enrollment_provider_for_architecture(&gdrive, &shared, Some("joiner@example.com")),
        Err(ValidationError::SharedStorageTargetRequired)
    );

    let granted = enrollment_provider_for_architecture_with_storage_target(
        &gdrive,
        &shared,
        Some("joiner@example.com"),
        Some("shared-folder-xyz"),
    )?;
    assert_eq!(
        granted,
        EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "shared-folder-xyz".to_owned(),
        ))
    );

    let personal = VaultArchitecture::default();
    let provider = enrollment_provider_for_architecture(&gdrive, &personal, None)?;
    assert_eq!(
        provider,
        EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
            "google-drive".to_owned(),
            "token".to_owned(),
            crate::OAuthRefreshCredential::NotIssued,
            crate::OAuthTokenExpiry::Unknown,
            crate::OAuthRemoteFile::Identified {
                file_id: "file-123".to_owned(),
                file_name: "nook.yaml".to_owned(),
            },
            crate::OAuthAccountIdentity::Unknown,
        ))
    );

    let mut shared_gdrive = gdrive.clone();
    let shared_oauth = shared_gdrive
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
    shared_oauth.drive_mode = GoogleDriveMode::Shared;
    shared_oauth.folder_id = Some("persisted-shared-folder".to_owned());
    assert_eq!(
        provider_onboarding_type(&shared_gdrive, &personal),
        Ok(OnboardingType::SharedProviderGrant)
    );
    assert_eq!(
        enrollment_provider_for_architecture(
            &shared_gdrive,
            &personal,
            Some("joiner@example.com")
        )?,
        EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "persisted-shared-folder".to_owned(),
        ))
    );

    shared_gdrive
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?
        .folder_id = None;
    assert_eq!(
        enrollment_provider_for_architecture(&shared_gdrive, &personal, Some("joiner@example.com")),
        Err(ValidationError::SharedStorageTargetRequired)
    );
    Ok(())
}

#[test]
fn enrollment_payload_variants_define_the_onboarding_credential_policy() -> anyhow::Result<()> {
    let personal = EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
        "google-drive".to_owned(),
        "owner-token".to_owned(),
        crate::OAuthRefreshCredential::Token("owner-refresh".to_owned()),
        crate::OAuthTokenExpiry::Unknown,
        crate::OAuthRemoteFile::Identified {
            file_id: "private-file".to_owned(),
            file_name: "nook-events".to_owned(),
        },
        crate::OAuthAccountIdentity::Email("owner@example.com".to_owned()),
    ));
    assert_eq!(
        enrollment_provider_onboarding_type(&personal),
        OnboardingType::PersonalCredentialTransfer
    );

    let shared = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
        "joiner@example.com".to_owned(),
        "shared-folder".to_owned(),
    ));
    assert_eq!(
        enrollment_provider_onboarding_type(&shared),
        OnboardingType::SharedProviderGrant
    );

    let serialized = serde_json::to_value(shared)?;
    assert_eq!(serialized["onboardingType"], "shared-provider-grant");
    assert_eq!(serialized["provider"]["storage_target_id"], "shared-folder");
    let serialized = serialized.to_string();
    assert!(!serialized.contains("access_token"));
    assert!(!serialized.contains("refresh_token"));
    assert!(!serialized.contains("pat"));
    Ok(())
}

#[test]
fn private_icloud_row_is_not_ready_for_shared_replication() -> anyhow::Result<()> {
    let mut icloud = oauth_provider("icloud", OauthFilePreset::ICloud, None, "nook-events");
    let oauth = icloud
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
    oauth.icloud_mode = ICloudMode::Private;

    assert!(validate_provider_row_replication(&icloud, ReplicationType::Personal).is_ok());
    assert_eq!(
        validate_provider_row_replication(&icloud, ReplicationType::Shared),
        Err(ValidationError::SharedStorageTargetRequired)
    );

    let oauth = icloud
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
    oauth.icloud_mode = ICloudMode::Shared;
    oauth.icloud_share_target = Some("not-a-cloudkit-share-target".to_owned());
    assert_eq!(
        validate_provider_row_replication(&icloud, ReplicationType::Shared),
        Err(ValidationError::SharedStorageTargetRequired)
    );
    Ok(())
}

#[test]
fn shared_icloud_onboarding_carries_target_without_owner_credentials() -> anyhow::Result<()> {
    let target = crate::ICloudSharedTarget::new(
        crate::ICloudShareRole::Owner,
        "zone",
        "owner",
        "root",
        "guid",
    )?
    .to_storage_id()?;
    let mut icloud = oauth_provider("icloud", OauthFilePreset::ICloud, None, "nook-events");
    let oauth = icloud
        .oauth_file
        .as_mut()
        .ok_or_else(|| std::io::Error::other("test as_mut value must exist"))?;
    oauth.icloud_mode = ICloudMode::Shared;
    oauth.icloud_share_target = Some(target.clone());

    let wire = serde_json::to_value(&icloud)?;
    assert_eq!(wire["oauthFile"]["iCloudMode"], "shared");
    assert_eq!(wire["oauthFile"]["iCloudShareTarget"], target);
    let icloud: StorageProviderData = serde_json::from_value(wire)?;

    assert_eq!(
        provider_onboarding_type(&icloud, &VaultArchitecture::default()),
        Ok(OnboardingType::SharedProviderGrant)
    );
    assert_eq!(
        enrollment_provider_for_architecture(&icloud, &VaultArchitecture::default(), None)?,
        EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(target.clone()))
    );
    let args = storage_args_for_provider(&icloud)?;
    assert_eq!(args.mode, "icloud");
    assert_eq!(args.pat, "token");
    assert_eq!(args.repo, format!("{target}\tnook-events"));
    Ok(())
}

#[test]
fn active_vault_provider_scope_and_roles_are_core_owned() -> anyhow::Result<()> {
    let mut local_a = github_provider("local-a", "ignored", "ignored");
    local_a.provider_type = StorageProviderType::Local.as_str().to_owned();
    local_a.store_id = Some("store-a".to_owned());
    let mut github_a = github_provider("github-a", "owner/a", "pat-a");
    github_a.store_id = Some("store-a".to_owned());
    let mut github_b = github_provider("github-b", "owner/b", "pat-b");
    github_b.store_id = Some("store-b".to_owned());
    let unscoped = github_provider("unscoped", "owner/unscoped", "pat-unscoped");
    let providers = vec![local_a.clone(), github_a.clone(), github_b, unscoped];

    assert_eq!(
        active_vault_providers(&providers, Some(" store-a ")),
        vec![local_a.clone(), github_a.clone()]
    );
    assert_eq!(
        sync_providers_for_active_vault(&providers, Some("store-a"))?,
        vec![github_a]
    );
    assert_eq!(
        local_provider_for_active_vault(&providers, Some("store-a"))?,
        Some(local_a.clone())
    );
    assert_eq!(
        provider_label_by_id(&providers, "github-b"),
        Some("GitHub".to_owned())
    );
    assert_eq!(
        providers_visible_while_device_locked(&providers),
        vec![local_a]
    );
    Ok(())
}

#[test]
fn incoming_pairing_replaces_only_that_vaults_provider_grants() -> anyhow::Result<()> {
    let mut removed_a = github_provider("removed-a", "owner/old", "pat-old");
    removed_a.store_id = Some("store-a".to_owned());
    let mut retained_b = github_provider("retained-b", "owner/b", "pat-b");
    retained_b.store_id = Some("store-b".to_owned());
    let mut replacement_a = github_provider("replacement-a", "owner/new", "pat-new");
    replacement_a.store_id = None;
    let existing = AuthProvidersSnapshotData {
        providers: vec![removed_a, retained_b.clone()],
        active_vault_store_id: Some("store-a".to_owned()),
    };
    let incoming = AuthProvidersSnapshotData {
        providers: vec![replacement_a],
        active_vault_store_id: Some("store-a".to_owned()),
    };

    let replaced = replace_active_vault_provider_grants(&existing, &incoming);

    assert_eq!(replaced.providers.len(), 2);
    assert!(replaced.providers.contains(&retained_b));
    let replacement = replaced
        .providers
        .iter()
        .find(|provider| provider.id == "replacement-a")
        .expect("replacement provider");
    assert_eq!(replacement.store_id.as_deref(), Some("store-a"));
    assert!(
        replaced
            .providers
            .iter()
            .all(|provider| provider.id != "removed-a")
    );
    Ok(())
}

#[test]
fn incoming_pairing_discards_unscoped_rows() -> anyhow::Result<()> {
    let unscoped = github_provider("unscoped-a", "owner/a", "pat-a");
    let existing = AuthProvidersSnapshotData {
        providers: vec![unscoped],
        active_vault_store_id: Some("store-a".to_owned()),
    };
    let incoming = AuthProvidersSnapshotData {
        providers: Vec::new(),
        active_vault_store_id: Some("store-b".to_owned()),
    };

    let replaced = replace_active_vault_provider_grants(&existing, &incoming);

    assert!(replaced.providers.is_empty());
    Ok(())
}

#[test]
fn empty_incoming_pairing_removes_every_provider_for_that_vault() -> anyhow::Result<()> {
    let mut removed_a = github_provider("removed-a", "owner/a", "pat-a");
    removed_a.store_id = Some("store-a".to_owned());
    let mut retained_b = github_provider("retained-b", "owner/b", "pat-b");
    retained_b.store_id = Some("store-b".to_owned());
    let existing = AuthProvidersSnapshotData {
        providers: vec![removed_a, retained_b.clone()],
        active_vault_store_id: Some("store-a".to_owned()),
    };
    let incoming = AuthProvidersSnapshotData {
        providers: Vec::new(),
        active_vault_store_id: Some("store-a".to_owned()),
    };

    let replaced = replace_active_vault_provider_grants(&existing, &incoming);

    assert_eq!(replaced.providers, vec![retained_b]);
    Ok(())
}

#[test]
fn oauth_remote_reference_policy_is_core_owned() -> anyhow::Result<()> {
    let mut google = OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        file_id: Some("file-id".to_owned()),
        ..OAuthFileConfigData::default()
    };
    assert_eq!(
        oauth_remote_storage_ref(&google).as_deref(),
        Some("file-id")
    );

    google.folder_id = Some(" shared-folder ".to_owned());
    assert_eq!(
        oauth_remote_storage_ref(&google).as_deref(),
        Some("shared:shared-folder")
    );

    let updated = update_oauth_remote_ref(&google, " manager-ref ")
        .ok_or_else(|| std::io::Error::other("remote reference update must exist"))?;
    assert_eq!(updated.file_id.as_deref(), Some("manager-ref"));
    assert!(update_oauth_remote_ref(&updated, "manager-ref").is_none());
    assert!(update_oauth_remote_ref(&updated, " ").is_none());

    let icloud = OAuthFileConfigData {
        preset: OauthFilePreset::ICloud,
        icloud_share_target: Some("icloud-share-v1:{}".to_owned()),
        folder_id: Some("not-selected".to_owned()),
        ..OAuthFileConfigData::default()
    };
    assert_eq!(
        oauth_remote_storage_ref(&icloud).as_deref(),
        Some("icloud-share-v1:{}")
    );
    Ok(())
}

#[test]
fn staged_remote_args_reject_incomplete_drafts_and_normalize_targets() -> anyhow::Result<()> {
    assert_eq!(
        staged_remote_storage_args(StorageProviderType::Local, None, None, None)?,
        None
    );
    assert_eq!(
        staged_remote_storage_args(StorageProviderType::Github, Some("  "), None, None)?,
        None
    );
    assert_eq!(
        staged_remote_storage_args(
            StorageProviderType::Github,
            Some(" pat "),
            Some(" owner/repo "),
            None
        )?,
        Some(StorageConnectArgs {
            mode: "github".to_owned(),
            pat: "pat".to_owned(),
            repo: "owner/repo".to_owned(),
        })
    );

    let mut oauth = OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        access_token: " token ".to_owned(),
        file_id: Some("file-id".to_owned()),
        file_name: Some("stored-name".to_owned()),
        ..OAuthFileConfigData::default()
    };
    let args = staged_remote_storage_args(
        StorageProviderType::OauthFile,
        None,
        Some("draft-name"),
        Some(&oauth),
    )?
    .ok_or_else(|| std::io::Error::other("staged OAuth arguments must exist"))?;
    assert_eq!(args.mode, "google-drive");
    assert_eq!(args.pat, "token");
    assert_eq!(args.repo, "file-id\tdraft-name");

    oauth.preset = OauthFilePreset::GoogleDrive;
    oauth.drive_mode = GoogleDriveMode::Shared;
    oauth.folder_id = Some("shared-folder".to_owned());
    let args = staged_remote_storage_args(
        StorageProviderType::OauthFile,
        None,
        Some("ignored-draft-name"),
        Some(&oauth),
    )?
    .ok_or_else(|| std::io::Error::other("shared staged OAuth arguments must exist"))?;
    assert_eq!(args.repo, "shared:shared-folder\tstored-name");
    Ok(())
}

#[test]
fn provider_sync_metadata_update_preserves_unreported_fields() -> anyhow::Result<()> {
    let mut provider = github_provider("github", "owner/repo", "pat");
    provider.sync_checkpoint = ProviderSyncCheckpoint::Synced {
        version: ProviderSyncedVaultVersion::Version(9),
        synced_at: "earlier".to_owned(),
        revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
        common_content_hash: "old-hash".to_owned(),
    };
    let untouched = github_provider("other", "owner/other", "other-pat");

    let updated = update_provider_sync_metadata(
        &[provider, untouched.clone()],
        "github",
        "",
        ProviderSyncRevisionRef::Unreported,
        ManagerStoreScopeRef::Store(" store-1 "),
        "2026-07-17T12:00:00Z",
    );
    assert_eq!(
        updated[0].sync_checkpoint,
        ProviderSyncCheckpoint::Synced {
            version: ProviderSyncedVaultVersion::Version(9),
            synced_at: "2026-07-17T12:00:00Z".to_owned(),
            revision: ProviderSyncRevision::Revision("old-revision".to_owned()),
            common_content_hash: crate::vault_content_hash(""),
        }
    );
    assert_eq!(updated[0].store_id.as_deref(), Some("store-1"));
    assert_eq!(updated[1], untouched);
    Ok(())
}
