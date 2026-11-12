use nook_companion_core::{
    BrowserOAuthLocation, BrowserOAuthLocationEvidence, ExtensionIdentityScope,
    ExtensionPackageDistribution, KnownSimpleVault, OAuthOriginSupport,
    OAuthOriginUnsupportedReason, SentinelVaultMatch, SimpleVaultTarget, VaultAppBaseSelection,
    VaultHostObservation, VaultHostPolicy,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_cloudflare_pr_preview_host(hostname: &str) -> bool {
    OAuthOriginUnsupportedReason::for_unregistered_hostname(hostname)
        == OAuthOriginUnsupportedReason::CloudflarePrPreview
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookOAuthOriginSupport {
    inner: OAuthOriginSupport,
}

#[wasm_bindgen]
impl NookOAuthOriginSupport {
    #[wasm_bindgen]
    #[must_use]
    pub fn is_supported(&self) -> bool {
        matches!(
            self.inner,
            OAuthOriginSupport::LocationUnavailable | OAuthOriginSupport::Supported { .. }
        )
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn origin(&self) -> String {
        match &self.inner {
            OAuthOriginSupport::LocationUnavailable => String::new(),
            OAuthOriginSupport::Supported { origin }
            | OAuthOriginSupport::Unsupported { origin, .. } => origin.clone(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn is_unsupported(&self) -> bool {
        matches!(self.inner, OAuthOriginSupport::Unsupported { .. })
    }

    /// Reason when [`Self::is_unsupported`] is true; otherwise `UnregisteredOrigin`.
    #[wasm_bindgen]
    #[must_use]
    pub fn unsupported_reason(&self) -> OAuthOriginUnsupportedReason {
        match self.inner {
            OAuthOriginSupport::Unsupported { reason, .. } => reason,
            _ => OAuthOriginUnsupportedReason::UnregisteredOrigin,
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn resolve_oauth_origin_support(
    provider: nook_companion_core::BrowserOAuthProvider,
    origin: &str,
    hostname: &str,
) -> NookOAuthOriginSupport {
    let location = if origin.is_empty() || hostname.is_empty() {
        BrowserOAuthLocation::Unavailable
    } else {
        BrowserOAuthLocation::Observed(BrowserOAuthLocationEvidence { origin, hostname })
    };
    NookOAuthOriginSupport {
        inner: provider.origin_support(location),
    }
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn default_simple_vault_url() -> String {
    nook_companion_core::DEFAULT_SIMPLE_VAULT_URL.to_owned()
}

/// Vault target name a build pairs with when it names none.
#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn default_simple_vault_target_name() -> String {
    KnownSimpleVault::DEFAULT.name().to_owned()
}

/// Normalized Simple Vault base URL for a build's vault target: a known
/// target name or an absolute Simple Vault URL.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn resolve_simple_vault_target(input: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(input.parse::<SimpleVaultTarget>()?.base_url().into())
}

/// Download file-name suffix for a build's vault target (`""` or `"-<name>"`).
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_target_downloads_suffix(input: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(input
        .parse::<SimpleVaultTarget>()?
        .downloads_suffix()
        .to_owned())
}

/// Extension identity of a build for this vault target: the channel identity,
/// or one qualified by the vault (`{ kind: 'vaultIdentity', seedQualifier, displayQualifier }`).
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_target_extension_identity(
    input: &str,
) -> Result<Ts<ExtensionIdentityScope>, wasm_bindgen::JsError> {
    input
        .parse::<SimpleVaultTarget>()?
        .extension_identity_scope()
        .into_ts()
        .map_err(|_| wasm_bindgen::JsError::new("Extension identity could not be encoded."))
}

/// Deployment metadata file name a build for this vault target publishes.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_target_extension_metadata_file_name(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(input
        .parse::<SimpleVaultTarget>()?
        .extension_metadata_file_name()
        .into())
}

/// How a build for this vault target distributes its extension package.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_target_package_distribution(
    input: &str,
) -> Result<ExtensionPackageDistribution, wasm_bindgen::JsError> {
    Ok(input.parse::<SimpleVaultTarget>()?.package_distribution())
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn normalize_simple_vault_base_url(value: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(value).normalize_simple_vault_base_url()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_url(base_url: &str, path: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).simple_vault_url(path)?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn simple_vault_match_pattern(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).simple_vault_match_pattern()?)
}

/// Matching Sentinel base URL for `base_url`, or an empty string when none matches.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn matching_sentinel_vault_base_url(base_url: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(
        match VaultHostPolicy::new(base_url).matching_sentinel_vault_base_url()? {
            SentinelVaultMatch::UnsupportedHost => String::new(),
            SentinelVaultMatch::MatchingBaseUrl(url) => url,
        },
    )
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn sentinel_vault_match_patterns(base_url: &str) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).sentinel_vault_match_patterns()?)
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_simple_vault_hostname(hostname: &str) -> bool {
    VaultHostObservation::new(hostname).is_simple_vault_hostname()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_sentinel_vault_hostname(hostname: &str) -> bool {
    VaultHostObservation::new(hostname).is_sentinel_vault_hostname()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn nook_vault_app_exclude_match_patterns(
    base_url: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).nook_vault_app_exclude_match_patterns()?)
}

/// `base_url` may be empty when no configured vault base is available.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn is_nook_vault_app_url(
    candidate_url: &str,
    base_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let base_url = if base_url.is_empty() {
        VaultAppBaseSelection::KnownNookHosts
    } else {
        VaultAppBaseSelection::Configured(base_url)
    };
    Ok(VaultHostObservation::new(candidate_url).is_nook_vault_app_url(base_url)?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn belongs_to_simple_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).belongs_to_simple_vault(candidate_url)?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn belongs_to_sentinel_vault(
    base_url: &str,
    candidate_url: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    Ok(VaultHostPolicy::new(base_url).belongs_to_sentinel_vault(candidate_url)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn vault_target_exports_resolve_names_and_explicit_urls() -> Result<(), String> {
        assert_eq!(default_simple_vault_target_name(), "nokey");
        assert_eq!(
            resolve_simple_vault_target(&default_simple_vault_target_name())
                .map_err(|_| "default target failed".to_owned())?,
            default_simple_vault_url()
        );
        assert_eq!(
            resolve_simple_vault_target("meta-secret")
                .map_err(|_| "meta-secret failed".to_owned())?,
            "https://simple.meta-secret.io/"
        );
        assert_eq!(
            resolve_simple_vault_target("localhost").map_err(|_| "localhost failed".to_owned())?,
            "https://localhost:5173/"
        );
        assert_eq!(
            resolve_simple_vault_target("https://pr-12.nokey-simple.pages.dev")
                .map_err(|_| "preview failed".to_owned())?,
            "https://pr-12.nokey-simple.pages.dev/"
        );
        assert_eq!(
            matching_sentinel_vault_base_url("https://simple.meta-secret.io/")
                .map_err(|_| "sentinel failed".to_owned())?,
            "https://sentinel.nokey.sh/"
        );
        #[cfg(target_arch = "wasm32")]
        assert!(resolve_simple_vault_target("prod").is_err());
        Ok(())
    }

    struct DownloadsCase {
        input: &'static str,
        suffix: &'static str,
        distribution: ExtensionPackageDistribution,
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn vault_target_exports_name_downloads_and_distribution() -> Result<(), String> {
        for DownloadsCase {
            input,
            suffix,
            distribution,
        } in [
            DownloadsCase {
                input: "nokey",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
            DownloadsCase {
                input: "https://simple.meta-secret.io/",
                suffix: "-meta-secret",
                distribution: ExtensionPackageDistribution::ManualZip,
            },
            DownloadsCase {
                input: "localhost",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
            DownloadsCase {
                input: "https://pr-12.nokey-simple.pages.dev/",
                suffix: "",
                distribution: ExtensionPackageDistribution::StoreOnProductionChannel,
            },
        ] {
            assert_eq!(
                simple_vault_target_downloads_suffix(input)
                    .map_err(|_| format!("{input} suffix failed"))?,
                suffix
            );
            assert_eq!(
                simple_vault_target_package_distribution(input)
                    .map_err(|_| format!("{input} distribution failed"))?,
                distribution
            );
        }
        #[cfg(target_arch = "wasm32")]
        assert!(
            simple_vault_target_downloads_suffix("https://u:p@simple.meta-secret.io/").is_err()
        );
        Ok(())
    }

    struct MetadataCase {
        input: &'static str,
        metadata: &'static str,
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn vault_target_exports_name_the_metadata_file_the_vault_host_offers() -> Result<(), String> {
        for MetadataCase { input, metadata } in [
            MetadataCase {
                input: "nokey",
                metadata: "extension.json",
            },
            MetadataCase {
                input: "localhost",
                metadata: "extension.json",
            },
            MetadataCase {
                input: "https://pr-12.nokey-simple.pages.dev/",
                metadata: "extension.json",
            },
            MetadataCase {
                input: "meta-secret",
                metadata: "extension-meta-secret.json",
            },
            MetadataCase {
                input: "https://simple.meta-secret.io/",
                metadata: "extension-meta-secret.json",
            },
        ] {
            assert_eq!(
                simple_vault_target_extension_metadata_file_name(input)
                    .map_err(|_| format!("{input} metadata failed"))?,
                metadata
            );
        }
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn vault_target_extension_identity_export_encodes_the_scope()
    -> Result<(), wasm_bindgen::JsError> {
        let nokey: serde_json::Value = serde_wasm_bindgen::from_value(
            simple_vault_target_extension_identity("nokey")?.js_value(),
        )?;
        assert_eq!(nokey, serde_json::json!({ "kind": "channelIdentity" }));
        let meta_secret: serde_json::Value = serde_wasm_bindgen::from_value(
            simple_vault_target_extension_identity("meta-secret")?.js_value(),
        )?;
        assert_eq!(
            meta_secret,
            serde_json::json!({
                "kind": "vaultIdentity",
                "seedQualifier": "meta-secret",
                "displayQualifier": "meta-secret.io",
            })
        );
        Ok(())
    }
}
