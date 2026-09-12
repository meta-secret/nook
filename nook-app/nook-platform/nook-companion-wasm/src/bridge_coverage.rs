#[cfg(test)]
mod tests {
    use crate::*;
    #[cfg(not(target_arch = "wasm32"))]
    use nook_companion_core::VaultHostPolicy;
    use nook_companion_core::{
        ExtensionEventCount, ExtensionPairingRecord, ExtensionPairingRecordComparison,
        ExtensionPairingRecordComparisonRequest, ExtensionReadySetup, ExtensionReadySetupStatus,
        ExtensionSyncProviderCount,
    };

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn backup_code_and_vault_host_exports_preserve_core_results() -> Result<(), String> {
        assert!(page_has_backup_code_hint("Save your recovery codes"));
        assert!(contains_backup_code_candidate("A1B2-C3D4-E5F6"));
        assert_eq!(
            extract_backup_code_candidates("A1B2-C3D4-E5F6".to_owned()),
            vec!["A1B2-C3D4-E5F6"]
        );
        assert_eq!(
            normalize_simple_vault_base_url("https://simple.nokey.sh/root")
                .map_err(|error| format!("normalization failed: {error:?}"))?,
            "https://simple.nokey.sh/root/"
        );
        assert_eq!(
            simple_vault_url("https://simple.nokey.sh/root", "/login")
                .map_err(|error| format!("url failed: {error:?}"))?,
            "https://simple.nokey.sh/root/login"
        );
        assert!(
            simple_vault_match_pattern("https://simple.nokey.sh/root")
                .map_err(|error| format!("pattern failed: {error:?}"))?
                .ends_with("/root/*")
        );
        assert_eq!(
            matching_sentinel_vault_base_url("https://simple.nokey.sh/")
                .map_err(|error| format!("match failed: {error:?}"))?,
            "https://sentinel.nokey.sh/"
        );
        assert!(
            sentinel_vault_match_patterns("https://simple.nokey.sh/")
                .map_err(|error| format!("patterns failed: {error:?}"))?
                .iter()
                .any(|pattern| pattern.contains("sentinel.nokey.sh"))
        );
        assert!(is_simple_vault_hostname("simple.nokey.sh"));
        assert!(is_sentinel_vault_hostname("sentinel.nokey.sh"));
        assert!(
            nook_vault_app_exclude_match_patterns("https://simple.nokey.sh/")
                .map_err(|error| format!("exclusions failed: {error:?}"))?
                .iter()
                .any(|pattern| pattern.contains("simple.nokey.sh"))
        );
        assert!(
            is_nook_vault_app_url("https://simple.nokey.sh/app", "")
                .map_err(|error| format!("app URL failed: {error:?}"))?
        );
        assert!(
            belongs_to_simple_vault(
                "https://vault.example.test/simple/",
                "https://vault.example.test/simple/app",
            )
            .map_err(|error| format!("membership failed: {error:?}"))?
        );
        assert!(
            belongs_to_sentinel_vault("https://simple.nokey.sh/", "https://sentinel.nokey.sh/app",)
                .map_err(|error| format!("sentinel membership failed: {error:?}"))?
        );
        #[cfg(target_arch = "wasm32")]
        assert!(simple_vault_url("http://example.test", "/app").is_err());
        #[cfg(not(target_arch = "wasm32"))]
        assert!(
            VaultHostPolicy::new("http://example.test")
                .simple_vault_url("/app")
                .is_err()
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn oauth_support_export_covers_supported_unavailable_and_preview_states() {
        let preview = resolve_oauth_origin_support(
            nook_companion_core::BrowserOAuthProvider::GoogleDrive,
            "https://pr-42.nokey-simple.pages.dev",
            "PR-42.NOKEY-SIMPLE.PAGES.DEV",
        );
        assert!(preview.is_unsupported());
        assert_eq!(
            preview.unsupported_reason(),
            nook_companion_core::OAuthOriginUnsupportedReason::CloudflarePrPreview
        );
        assert!(!preview.is_supported());
        let unavailable = resolve_oauth_origin_support(
            nook_companion_core::BrowserOAuthProvider::GoogleDrive,
            "",
            "",
        );
        assert!(unavailable.is_supported());
        assert!(!unavailable.is_unsupported());
        assert!(unavailable.origin().is_empty());
        let supported = resolve_oauth_origin_support(
            nook_companion_core::BrowserOAuthProvider::GoogleDrive,
            "https://simple.nokey.sh",
            "simple.nokey.sh",
        );
        assert!(supported.is_supported());
        assert_eq!(supported.origin(), "https://simple.nokey.sh");
        assert_eq!(
            supported.unsupported_reason(),
            nook_companion_core::OAuthOriginUnsupportedReason::UnregisteredOrigin
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn setup_json_and_pairing_record_comparison_exports_preserve_typed_results()
    -> Result<(), String> {
        let setup = ExtensionReadySetup {
            status: ExtensionReadySetupStatus::Ready,
            device_label: "Nook Extension".to_owned(),
            paired_vaults: vec!["store-test".to_owned()],
            selected_vault_store_id: "store-test".to_owned(),
            selected_vault_name: "Personal".to_owned(),
            sync_provider_count: ExtensionSyncProviderCount::from(1),
            event_count: ExtensionEventCount::from(2),
            event_log_heads: vec!["event-2".to_owned()],
            last_local_sync_at: "2026-09-05T00:00:01.000Z".to_owned(),
        };
        let serialized = serde_json::to_string(&setup).map_err(|error| error.to_string())?;
        assert!(is_extension_ready_setup_json(&serialized));
        assert!(!is_extension_ready_setup_json("{}"));

        assert_eq!(
            compare_extension_pairing_records(ExtensionPairingRecordComparisonRequest {
                current: ExtensionPairingRecord::Setup(setup.clone()),
                migrated: ExtensionPairingRecord::Setup(setup.clone()),
            }),
            ExtensionPairingRecordComparison::Equivalent
        );
        let mut changed = setup.clone();
        changed.selected_vault_name = "Work".to_owned();
        assert_eq!(
            compare_extension_pairing_records(ExtensionPairingRecordComparisonRequest {
                current: ExtensionPairingRecord::Setup(changed),
                migrated: ExtensionPairingRecord::Setup(setup),
            }),
            ExtensionPairingRecordComparison::Different
        );
        Ok(())
    }
}
