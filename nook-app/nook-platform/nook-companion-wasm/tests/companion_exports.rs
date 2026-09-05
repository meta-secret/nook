#![cfg(target_arch = "wasm32")]

use nook_companion_core::{ExtensionPersistenceArea, ExtensionPersistenceObservation};
use nook_companion_wasm::*;
use wasm_bindgen_test::wasm_bindgen_test;

fn js_error(error: impl std::fmt::Display) -> wasm_bindgen::JsError {
    wasm_bindgen::JsError::new(&error.to_string())
}

fn pairing_approval() -> nook_companion_core::ExtensionPairingGrantApproval {
    nook_companion_core::ExtensionPairingGrantApproval {
        vault_type: nook_companion_core::ExtensionPairingVaultType::Simple,
        device_id: "device-test".to_owned(),
        device_public_key: "age1test".to_owned(),
        device_signing_public_key: "signing-test".to_owned(),
        device_label: "Nook Extension".to_owned(),
        vault_store_id: "store-test".to_owned(),
        vault_name: "Personal".to_owned(),
        approved_at: "2026-09-05T00:00:00.000Z".to_owned(),
        scopes: vec![nook_companion_core::ExtensionConnectScope::PasswordFilling],
        sync_provider_count: 1,
    }
}

fn imported_event_log(event_count: u32) -> nook_companion_core::ImportedExtensionEventLog {
    nook_companion_core::ImportedExtensionEventLog {
        vault_store_id: "store-test".to_owned(),
        event_count,
        heads: vec![format!("event-{event_count}")],
        access_granted: true,
    }
}

#[wasm_bindgen_test]
fn backup_and_persistence_collection_exports_preserve_core_results() {
    assert!(contains_backup_code_candidate("A1B2-C3D4-E5F6"));
    assert!(!contains_backup_code_candidate("ordinary sentence"));

    let area = ExtensionPersistenceArea::EventLog;
    assert_eq!(
        extension_persistence_store_names(area),
        vec![
            "vault".to_owned(),
            "events".to_owned(),
            "projections".to_owned(),
            "provider_receipts".to_owned(),
            "outbox".to_owned(),
        ]
    );
    assert_eq!(
        matching_extension_persistence_stores(ExtensionPersistenceObservation {
            area,
            observed_names: vec!["foreign".to_owned(), "events".to_owned()],
        }),
        vec!["events".to_owned()]
    );
}

#[wasm_bindgen_test]
fn authentication_outcome_exports_preserve_commit_policy_and_timeout() {
    let sufficient = classify_companion_authentication_outcome(
        nook_companion_core::AuthenticationOutcomeClassification {
            observation: nook_companion_core::AuthenticationOutcomeObservation {
                success_marker_present: true,
                ..Default::default()
            },
            timeout_ms: 1_000,
        },
    );
    assert_eq!(
        sufficient.verdict,
        nook_companion_core::AuthenticationOutcomeVerdict::Sufficient
    );
    assert!(sufficient.allows_credential_commit);
    assert_eq!(
        validate_companion_authentication_outcome_decision(sufficient),
        sufficient
    );

    let conflicting = classify_companion_authentication_outcome(
        nook_companion_core::AuthenticationOutcomeClassification {
            observation: nook_companion_core::AuthenticationOutcomeObservation {
                success_marker_present: true,
                error_marker_present: true,
                ..Default::default()
            },
            timeout_ms: 1_000,
        },
    );
    assert_eq!(
        conflicting.verdict,
        nook_companion_core::AuthenticationOutcomeVerdict::Conflicting
    );
    assert!(!conflicting.allows_credential_commit);

    let timed_out = classify_companion_authentication_outcome_with_default_timeout(
        nook_companion_core::AuthenticationOutcomeObservation {
            elapsed_ms: nook_companion_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
            ..Default::default()
        },
    );
    assert_eq!(
        timed_out.verdict,
        nook_companion_core::AuthenticationOutcomeVerdict::Timeout
    );
}

#[wasm_bindgen_test]
fn extension_scope_and_storage_key_exports_are_closed() {
    assert_eq!(
        extension_pairing_grant_storage_key("store-test"),
        "nook:extension-pairing-grant:store-test"
    );
    assert_eq!(
        extension_pairing_setup_storage_key(),
        "nook:extension-setup"
    );
    for (scope, serialized) in [
        (extension_vault_access_scope(), "vault-access"),
        (extension_password_filling_scope(), "password-filling"),
        (extension_passkey_management_scope(), "passkey-management"),
        (
            extension_sync_provider_credentials_scope(),
            "sync-provider-credentials",
        ),
    ] {
        assert_eq!(scope.as_str(), serialized);
        assert!(is_extension_connect_scope(serialized));
    }
    assert!(!is_extension_connect_scope("foreign-scope"));
}

#[wasm_bindgen_test]
fn pairing_state_exports_preserve_create_refresh_selection_and_removal()
-> Result<(), wasm_bindgen::JsError> {
    assert!(matches!(
        selected_extension_pairing_grant(nook_companion_core::ExtensionPairingState::default()),
        nook_companion_core::SelectedExtensionPairingGrant::NotSelected
    ));
    assert!(matches!(
        first_extension_pairing_grant(nook_companion_core::ExtensionPairingState::default()),
        nook_companion_core::SelectedExtensionPairingGrant::NotSelected
    ));

    let created =
        create_extension_pairing_state(nook_companion_core::CreateExtensionPairingStateInput {
            grant: pairing_approval(),
            imported: imported_event_log(2),
            observed_at: "2026-09-05T00:00:01.000Z".to_owned(),
        })?;
    let ordered = ordered_extension_pairing_grants(created.clone());
    assert_eq!(ordered.len(), 1);
    assert_eq!(ordered[0].event_count, 2);
    assert!(matches!(
        selected_extension_pairing_grant(created.clone()),
        nook_companion_core::SelectedExtensionPairingGrant::Selected { grant }
            if grant.vault_store_id == "store-test"
    ));
    assert!(matches!(
        first_extension_pairing_grant(created.clone()),
        nook_companion_core::SelectedExtensionPairingGrant::Selected { grant }
            if grant.vault_store_id == "store-test"
    ));
    assert!(matches!(
        extension_setup_after_pairing_grant_removal(
            nook_companion_core::ExtensionPairingGrantRemovalInput {
                state: created.clone(),
                removed_vault_store_id: "store-other".to_owned(),
            }
        ),
        nook_companion_core::ExtensionSetupAfterRemoval::Ready { setup }
            if setup.selected_vault_store_id == "store-test"
    ));

    let refreshed =
        refresh_extension_pairing_grant(nook_companion_core::RefreshExtensionPairingGrantInput {
            grant: ordered[0].clone(),
            imported: imported_event_log(4),
            observed_at: "2026-09-05T00:00:04.000Z".to_owned(),
            select: true,
        })?;
    assert_eq!(
        ordered_extension_pairing_grants(refreshed.clone())[0].event_count,
        4
    );
    assert!(matches!(
        extension_setup_after_pairing_grant_removal(
            nook_companion_core::ExtensionPairingGrantRemovalInput {
                state: refreshed,
                removed_vault_store_id: "store-test".to_owned(),
            }
        ),
        nook_companion_core::ExtensionSetupAfterRemoval::NoPairedVault
    ));

    let mut mismatched = imported_event_log(2);
    mismatched.vault_store_id = "store-other".to_owned();
    assert!(
        create_extension_pairing_state(nook_companion_core::CreateExtensionPairingStateInput {
            grant: pairing_approval(),
            imported: mismatched,
            observed_at: "2026-09-05T00:00:01.000Z".to_owned(),
        })
        .is_err()
    );
    Ok(())
}

#[wasm_bindgen_test]
fn pairing_json_exports_validate_current_records_and_reject_malformed_legacy_state()
-> Result<(), wasm_bindgen::JsError> {
    let state =
        create_extension_pairing_state(nook_companion_core::CreateExtensionPairingStateInput {
            grant: pairing_approval(),
            imported: imported_event_log(2),
            observed_at: "2026-09-05T00:00:01.000Z".to_owned(),
        })?;
    let grant = ordered_extension_pairing_grants(state)[0].clone();
    let grant_json = serde_json::to_string(&grant).map_err(js_error)?;
    assert!(is_stored_extension_pairing_grant_json(&grant_json));
    assert!(!is_stored_extension_pairing_grant_json("{}"));

    let setup = nook_companion_core::ExtensionReadySetup {
        status: nook_companion_core::ExtensionReadySetupStatus::Ready,
        device_label: grant.device_label.clone(),
        paired_vaults: vec![grant.vault_name.clone()],
        selected_vault_store_id: grant.vault_store_id.clone(),
        selected_vault_name: grant.vault_name.clone(),
        sync_provider_count: grant.sync_provider_count,
        event_count: grant.event_count,
        event_log_heads: grant.event_log_heads.clone(),
        last_local_sync_at: grant.last_local_sync_at.clone(),
    };
    let setup_json = serde_json::to_string(&setup).map_err(js_error)?;
    assert!(is_extension_ready_setup_json(&setup_json));
    assert!(!is_extension_ready_setup_json("{}"));
    assert!(migrate_legacy_extension_pairing_state_json("{").is_err());
    Ok(())
}

#[wasm_bindgen_test]
fn oauth_support_exports_preserve_unavailable_supported_and_preview_rejection() {
    let unavailable = resolve_oauth_origin_support(
        nook_companion_core::BrowserOAuthProvider::GoogleDrive,
        "",
        "",
    );
    assert!(unavailable.is_supported());
    assert_eq!(unavailable.origin(), "");
    assert_eq!(
        unavailable.unsupported_reason(),
        nook_companion_core::OAuthOriginUnsupportedReason::UnregisteredOrigin
    );

    let supported = resolve_oauth_origin_support(
        nook_companion_core::BrowserOAuthProvider::GoogleDrive,
        "https://simple.nokey.sh",
        "simple.nokey.sh",
    );
    assert_eq!(supported.origin(), "https://simple.nokey.sh");
    assert!(!supported.is_unsupported());

    let preview = resolve_oauth_origin_support(
        nook_companion_core::BrowserOAuthProvider::GoogleDrive,
        "https://pr-42.nokey-simple.pages.dev",
        "pr-42.nokey-simple.pages.dev",
    );
    assert!(preview.is_unsupported());
    assert!(!preview.is_supported());
    assert_eq!(
        preview.unsupported_reason(),
        nook_companion_core::OAuthOriginUnsupportedReason::CloudflarePrPreview
    );
    assert_eq!(preview.origin(), "https://pr-42.nokey-simple.pages.dev");
    assert!(is_cloudflare_pr_preview_host(
        "pr-42.nokey-simple.pages.dev"
    ));
    assert!(!is_cloudflare_pr_preview_host("simple.nokey.sh"));
}

#[wasm_bindgen_test]
fn vault_url_exports_preserve_paths_patterns_membership_and_errors()
-> Result<(), wasm_bindgen::JsError> {
    assert_eq!(default_simple_vault_url(), "https://simple.nokey.sh/");
    assert_eq!(
        simple_vault_url("https://simple.nokey.sh/root", "/login")?,
        "https://simple.nokey.sh/root/login"
    );
    assert_eq!(
        simple_vault_match_pattern("https://simple.nokey.sh/root")?,
        "https://simple.nokey.sh/root/*"
    );
    assert_eq!(
        matching_sentinel_vault_base_url("https://simple.nokey.sh/")?,
        "https://sentinel.nokey.sh/"
    );
    assert_eq!(
        matching_sentinel_vault_base_url("https://vault.example.test/")?,
        ""
    );
    assert!(
        sentinel_vault_match_patterns("https://simple.dev.nokey.sh/")?
            .iter()
            .any(|pattern| pattern == "https://sentinel.dev.nokey.sh/*")
    );
    assert!(
        nook_vault_app_exclude_match_patterns("https://simple.nokey.sh/")?
            .iter()
            .any(|pattern| pattern == "https://simple.nokey.sh/*")
    );
    assert!(is_nook_vault_app_url(
        "https://sentinel.dev.nokey.sh/app",
        ""
    )?);
    assert!(is_nook_vault_app_url(
        "https://vault.example.test/simple/app",
        "https://vault.example.test/simple/"
    )?);
    assert!(belongs_to_simple_vault(
        "https://vault.example.test/simple/",
        "https://vault.example.test/simple/app"
    )?);
    assert!(belongs_to_sentinel_vault(
        "https://simple.nokey.sh/",
        "https://sentinel.nokey.sh/app"
    )?);
    assert!(simple_vault_url("http://example.test", "/app").is_err());
    assert!(is_nook_vault_app_url("not a URL", "").is_err());
    Ok(())
}
