#[cfg(test)]
mod tests {
    use crate::*;

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
        assert!(simple_vault_url("http://example.test", "/app").is_err());
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
}
