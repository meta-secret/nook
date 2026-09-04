use crate::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservations, NookAuthenticationWorkflowMatch,
    NookVaultSecurityRecommendations,
};
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
            nook_core::AppLocale::English => Self::English,
            nook_core::AppLocale::Russian => Self::Russian,
            nook_core::AppLocale::Unsupported => Self::Unsupported,
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn translate_key(locale: &str, key: &str) -> String {
    nook_core::translate(locale, key)
}

#[wasm_bindgen]
#[must_use]
pub fn classify_vault_recovery_error(message: &str) -> nook_core::VaultRecoveryErrorKind {
    nook_core::classify_vault_recovery_error(message)
}

#[wasm_bindgen]
#[must_use]
pub fn device_protection_status_name(status: nook_core::DeviceProtectionStatus) -> String {
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
pub fn assess_vault_security(
    sync_provider_count: u32,
    enrolled_device_count: u32,
) -> NookVaultSecurityRecommendations {
    NookVaultSecurityRecommendations::from_core(nook_core::assess_vault_security(
        sync_provider_count as usize,
        enrolled_device_count as usize,
    ))
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_workflow_snapshot(
    observations: &NookAuthenticationPageObservations,
) -> NookAuthenticationWorkflowMatch {
    NookAuthenticationWorkflowMatch::from_core(
        nook_core::classify_authentication_workflow_candidates(observations.as_core()),
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
pub fn classify_authentication_outcome(
    observation: &NookAuthenticationOutcomeObservation,
    timeout_ms: u32,
) -> NookAuthenticationOutcomeVerdict {
    NookAuthenticationOutcomeVerdict::from_core(nook_core::classify_authentication_outcome(
        observation.to_core(),
        timeout_ms,
    ))
}

#[wasm_bindgen]
#[must_use]
pub fn classify_authentication_outcome_with_default_timeout(
    observation: &NookAuthenticationOutcomeObservation,
) -> NookAuthenticationOutcomeVerdict {
    NookAuthenticationOutcomeVerdict::from_core(nook_core::classify_authentication_outcome(
        observation.to_core(),
        nook_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
    ))
}

#[wasm_bindgen]
#[must_use]
pub fn parse_app_locale(value: &str) -> NookAppLocaleParse {
    nook_core::parse_app_locale(value).into()
}

#[wasm_bindgen]
#[must_use]
pub fn resolve_app_locale_from_tag(tag: &str) -> NookAppLocaleParse {
    nook_core::resolve_app_locale_from_tag(tag).into()
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn resolve_app_locale_from_tags(tags: Vec<String>) -> String {
    nook_core::resolve_app_locale_from_tags(tags.iter().map(String::as_str)).to_owned()
}

#[wasm_bindgen]
pub fn supported_app_locale_code(
    locale: NookAppLocaleParse,
) -> Result<String, wasm_bindgen::JsError> {
    match locale {
        NookAppLocaleParse::English => Ok("en".to_owned()),
        NookAppLocaleParse::Russian => Ok("ru".to_owned()),
        NookAppLocaleParse::Unsupported => Err(wasm_bindgen::JsError::new(
            "unsupported locale does not have an application locale code",
        )),
    }
}

#[wasm_bindgen]
#[must_use]
pub fn get_translation_catalog(locale: &str) -> String {
    nook_core::get_translation_catalog(locale).to_owned()
}

#[wasm_bindgen]
pub fn lookup_translation(catalog_json: &str, key: &str) -> Result<String, wasm_bindgen::JsError> {
    nook_core::lookup_translation(catalog_json, key)
        .ok_or_else(|| wasm_bindgen::JsError::new(&format!("missing translation key: {key}")))
}

#[wasm_bindgen]
#[must_use]
pub fn translate_from_catalog(catalog_json: &str, locale: &str, key: &str) -> String {
    nook_core::translate_from_catalog(catalog_json, locale, key)
}

#[wasm_bindgen]
#[must_use]
pub fn translate_with_replacements(
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
    nook_core::translate_with_replacements(catalog_json, locale, key, &replacements)
}

#[wasm_bindgen]
#[must_use]
pub fn resolve_error_message(catalog_json: &str, locale: &str, message: &str) -> String {
    nook_core::resolve_error_message(catalog_json, locale, message)
}

#[wasm_bindgen]
pub fn merge_translation_catalogs(
    base_json: &str,
    overlay_json: &str,
) -> Result<String, wasm_bindgen::JsError> {
    nook_core::merge_translation_catalogs(base_json, overlay_json).map_err(Into::into)
}

#[wasm_bindgen]
#[must_use]
pub fn resolve_translation_catalog(locale: &str, wasm_catalog_json: &str) -> String {
    nook_core::resolve_translation_catalog(locale, Some(wasm_catalog_json))
}

#[wasm_bindgen]
#[must_use]
pub fn default_translation_catalog(locale: &str) -> String {
    nook_core::resolve_translation_catalog(locale, None)
}
