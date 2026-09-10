use crate::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservations, NookAuthenticationWorkflowMatch,
    NookVaultSecurityRecommendations,
};
use nook_core::AuthenticationOutcomeObservation;
use nook_core::AuthenticationWorkflowMatch;
use nook_core::VaultSecurityAssessment;
use nook_core::{AppLocale, VaultRecoveryErrorKind};
use nook_core::{
    LookupTranslationRequest, MergeTranslationCatalogsRequest, ResolveErrorMessageRequest,
    ResolveTranslationCatalogRequest, TranslateFromCatalogRequest, TranslateRequest,
    TranslateWithReplacementsRequest, TranslationCatalog,
};
use nook_core::{TranslationCatalogSource, TranslationLookup};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookAppLocaleParse {
    Unsupported,
    English,
    Russian,
}

impl From<nook_core::AppLocale> for NookAppLocaleParse {
    fn from(locale: nook_core::AppLocale) -> Self {
        match locale {
            AppLocale::English => Self::English,
            AppLocale::Russian => Self::Russian,
            AppLocale::Unsupported => Self::Unsupported,
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn translate_key(locale: &str, key: &str) -> String {
    TranslationCatalog::translate(TranslateRequest {
        locale: locale,
        key: key,
    })
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_vault_recovery_error(message: &str) -> nook_core::VaultRecoveryErrorKind {
    VaultRecoveryErrorKind::classify_vault_recovery_error(message)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn device_protection_status_name(status: nook_core::DeviceProtectionStatus) -> String {
    status.as_str().to_owned()
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `assess_vault_security` count through a JavaScript Number scalar"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn assess_vault_security(
    sync_provider_count: u32,
    enrolled_device_count: u32,
) -> NookVaultSecurityRecommendations {
    NookVaultSecurityRecommendations::from_core(
        nook_core::VaultSecurityRecommendations::assess_vault_security(VaultSecurityAssessment {
            sync_provider_count: (sync_provider_count as usize).into(),
            enrolled_device_count: (enrolled_device_count as usize).into(),
        }),
    )
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_workflow_snapshot(
    observations: &NookAuthenticationPageObservations,
) -> NookAuthenticationWorkflowMatch {
    NookAuthenticationWorkflowMatch::from_core(
        AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(
            observations.as_core(),
        ),
    )
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the `classify_authentication_outcome` timestamp or duration through a JavaScript Number scalar"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_authentication_outcome(
    observation: &NookAuthenticationOutcomeObservation,
    timeout_ms: u32,
) -> NookAuthenticationOutcomeVerdict {
    NookAuthenticationOutcomeVerdict::from_core(
        (observation.to_core()).classify_authentication_outcome(timeout_ms.into()),
    )
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_authentication_outcome_with_default_timeout(
    observation: &NookAuthenticationOutcomeObservation,
) -> NookAuthenticationOutcomeVerdict {
    NookAuthenticationOutcomeVerdict::from_core(
        (observation.to_core())
            .classify_authentication_outcome(nook_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
    )
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn parse_app_locale(value: &str) -> NookAppLocaleParse {
    AppLocale::parse_app_locale(value).into()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn resolve_app_locale_from_tag(tag: &str) -> NookAppLocaleParse {
    AppLocale::resolve_app_locale_from_tag(tag).into()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn resolve_app_locale_from_tags(tags: Vec<String>) -> crate::types::NookAppLocale {
    nook_core::SupportedAppLocale::resolve(tags.iter().map(String::as_str))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn supported_app_locale_code(
    locale: NookAppLocaleParse,
) -> Result<crate::types::NookAppLocale, wasm_bindgen::JsError> {
    match locale {
        NookAppLocaleParse::English => Ok(nook_core::SupportedAppLocale::English),
        NookAppLocaleParse::Russian => Ok(nook_core::SupportedAppLocale::Russian),
        NookAppLocaleParse::Unsupported => Err(JsError::new(
            "unsupported locale does not have an application locale code",
        )),
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn get_translation_catalog(locale: &str) -> String {
    AppLocale::get_translation_catalog(locale).to_owned()
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn lookup_translation(catalog_json: &str, key: &str) -> Result<String, wasm_bindgen::JsError> {
    match TranslationCatalog::lookup_translation(LookupTranslationRequest {
        catalog_json: catalog_json,
        key: key,
    }) {
        TranslationLookup::Found(value) => Ok(value),
        TranslationLookup::Missing | TranslationLookup::InvalidCatalog => {
            Err(JsError::new(&format!("missing translation key: {key}")))
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn translate_from_catalog(catalog_json: &str, locale: &str, key: &str) -> String {
    TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
        catalog_json: catalog_json,
        locale: locale,
        key: key,
    })
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn translate_with_replacements(
    catalog_json: &str,
    locale: &str,
    key: &str,
    replacement_names: Vec<String>,
    replacement_values: Vec<String>,
) -> String {
    let replacements = replacement_names
        .into_iter()
        .zip(replacement_values)
        .collect::<Vec<_>>();
    TranslationCatalog::translate_with_replacements(TranslateWithReplacementsRequest {
        catalog_json: catalog_json,
        locale: locale,
        key: key,
        replacements: &replacements,
    })
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn resolve_error_message(catalog_json: &str, locale: &str, message: &str) -> String {
    TranslationCatalog::resolve_error_message(ResolveErrorMessageRequest {
        catalog_json: catalog_json,
        locale: locale,
        message: message,
    })
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn merge_translation_catalogs(
    base_json: &str,
    overlay_json: &str,
) -> Result<String, wasm_bindgen::JsError> {
    TranslationCatalog::merge_translation_catalogs(MergeTranslationCatalogsRequest {
        base_json: base_json,
        overlay_json: overlay_json,
    })
    .map_err(Into::into)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn resolve_translation_catalog(locale: &str, wasm_catalog_json: &str) -> String {
    TranslationCatalog::resolve_translation_catalog(ResolveTranslationCatalogRequest {
        locale: locale,
        wasm_catalog_json: TranslationCatalogSource::Supplied(wasm_catalog_json),
    })
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn default_translation_catalog(locale: &str) -> String {
    TranslationCatalog::resolve_translation_catalog(ResolveTranslationCatalogRequest {
        locale: locale,
        wasm_catalog_json: TranslationCatalogSource::Bundled,
    })
}

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn localization_adapters_project_locales_and_catalog_operations() {
        assert_eq!(parse_app_locale("en"), NookAppLocaleParse::English);
        assert_eq!(parse_app_locale("ru"), NookAppLocaleParse::Russian);
        assert_eq!(parse_app_locale("xx"), NookAppLocaleParse::Unsupported);
        assert_eq!(
            resolve_app_locale_from_tag("en-US"),
            NookAppLocaleParse::English
        );
        assert_eq!(
            resolve_app_locale_from_tag("ru-RU"),
            NookAppLocaleParse::Russian
        );
        assert_eq!(
            resolve_app_locale_from_tags(vec!["xx".into(), "ru".into()]).code(),
            "ru"
        );
        assert_eq!(
            supported_app_locale_code(NookAppLocaleParse::English)
                .unwrap()
                .code(),
            "en"
        );
        assert_eq!(
            supported_app_locale_code(NookAppLocaleParse::Russian)
                .unwrap()
                .code(),
            "ru"
        );
        assert!(supported_app_locale_code(NookAppLocaleParse::Unsupported).is_err());

        let catalog = get_translation_catalog("en");
        assert!(!catalog.is_empty());
        assert!(lookup_translation(&catalog, "missing.translation.key").is_err());
        assert!(!translate_key("en", "missing.translation.key").is_empty());
        assert!(!translate_from_catalog(&catalog, "en", "missing.translation.key").is_empty());
        assert!(
            !translate_with_replacements(
                &catalog,
                "en",
                "missing.translation.key",
                vec!["name".into()],
                vec!["Alice".into()],
            )
            .is_empty()
        );
        assert!(!resolve_error_message(&catalog, "en", "unknown error").is_empty());
        assert!(merge_translation_catalogs("{}", "{}").is_ok());
        assert!(!resolve_translation_catalog("en", &catalog).is_empty());
        assert!(!default_translation_catalog("en").is_empty());
    }
}
