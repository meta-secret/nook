use super::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservations, NookAuthenticationWorkflowMatch, NookStringValue,
    NookStringValueRef, NookVaultSecurityRecommendations, wasm_bindgen,
};

#[wasm_bindgen(js_name = translate)]
#[must_use]
pub fn translate_key(locale: &str, key: &str) -> String {
    nook_core::translate(locale, key)
}

#[wasm_bindgen(js_name = classifyVaultRecoveryError)]
#[must_use]
pub fn classify_vault_recovery_error(message: &str) -> nook_core::VaultRecoveryErrorKind {
    nook_core::classify_vault_recovery_error(message)
}

#[wasm_bindgen(js_name = deviceProtectionStatusName)]
#[must_use]
pub fn device_protection_status_name(status: nook_core::DeviceProtectionStatus) -> String {
    status.as_str().to_owned()
}

#[wasm_bindgen(js_name = assessVaultSecurity)]
#[must_use]
pub fn assess_vault_security(
    sync_provider_count: u32,
    enrolled_device_count: u32,
) -> NookVaultSecurityRecommendations {
    NookVaultSecurityRecommendations::from_core(nook_core::assess_vault_security(
        sync_provider_count as usize,
        enrolled_device_count as usize,
    ))
}

#[wasm_bindgen(js_name = authenticationWorkflowSnapshot)]
#[must_use]
pub fn authentication_workflow_snapshot(
    observations: &NookAuthenticationPageObservations,
) -> NookAuthenticationWorkflowMatch {
    NookAuthenticationWorkflowMatch::from_core(
        nook_core::classify_authentication_workflow_candidates(observations.as_core()),
    )
}

#[wasm_bindgen(js_name = classifyAuthenticationOutcome)]
#[must_use]
pub fn classify_authentication_outcome(
    observation: &NookAuthenticationOutcomeObservation,
    timeout_ms: Option<u32>,
) -> NookAuthenticationOutcomeVerdict {
    let timeout = timeout_ms.unwrap_or(nook_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS);
    NookAuthenticationOutcomeVerdict::from_core(nook_core::classify_authentication_outcome(
        observation.to_core(),
        timeout,
    ))
}

#[wasm_bindgen(js_name = parseAppLocale)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn parse_app_locale(value: NookStringValue) -> NookStringValue {
    let locale = match value.as_ref() {
        NookStringValueRef::Value(value) => nook_core::parse_app_locale(value),
        NookStringValueRef::Unavailable => nook_core::AppLocale::Unsupported,
    };
    app_locale_value(locale)
}

#[wasm_bindgen(js_name = resolveAppLocaleFromTag)]
#[must_use]
pub fn resolve_app_locale_from_tag(tag: &str) -> NookStringValue {
    app_locale_value(nook_core::resolve_app_locale_from_tag(tag))
}

#[wasm_bindgen(js_name = resolveAppLocaleFromTags)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn resolve_app_locale_from_tags(tags: Vec<String>) -> String {
    nook_core::resolve_app_locale_from_tags(tags.iter().map(String::as_str)).to_owned()
}

fn app_locale_value(locale: nook_core::AppLocale) -> NookStringValue {
    match locale {
        nook_core::AppLocale::English | nook_core::AppLocale::Russian => {
            NookStringValue::from_value(locale.code())
        }
        nook_core::AppLocale::Unsupported => NookStringValue::unavailable(),
    }
}

#[wasm_bindgen]
#[must_use]
pub fn get_translation_catalog(locale: &str) -> String {
    nook_core::get_translation_catalog(locale).to_owned()
}

#[wasm_bindgen(js_name = lookupTranslation)]
#[must_use]
pub fn lookup_translation(catalog_json: &str, key: &str) -> Option<String> {
    nook_core::lookup_translation(catalog_json, key)
}

#[wasm_bindgen(js_name = translateFromCatalog)]
#[must_use]
pub fn translate_from_catalog(catalog_json: &str, locale: &str, key: &str) -> String {
    nook_core::translate_from_catalog(catalog_json, locale, key)
}

#[wasm_bindgen(js_name = translateWithReplacements)]
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

#[wasm_bindgen(js_name = resolveErrorMessage)]
#[must_use]
pub fn resolve_error_message(catalog_json: &str, locale: &str, message: &str) -> String {
    nook_core::resolve_error_message(catalog_json, locale, message)
}

#[wasm_bindgen(js_name = mergeTranslationCatalogs)]
pub fn merge_translation_catalogs(
    base_json: &str,
    overlay_json: &str,
) -> Result<String, wasm_bindgen::JsError> {
    nook_core::merge_translation_catalogs(base_json, overlay_json).map_err(Into::into)
}

#[wasm_bindgen(js_name = resolveTranslationCatalog)]
#[must_use]
pub fn resolve_translation_catalog(locale: &str, wasm_catalog_json: Option<String>) -> String {
    match wasm_catalog_json {
        Some(wasm_catalog) => nook_core::resolve_translation_catalog(locale, Some(&wasm_catalog)),
        None => nook_core::resolve_translation_catalog(locale, None),
    }
}
