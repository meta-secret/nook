use crate::types::NookAppLocale;
use crate::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservations, NookAuthenticationWorkflowMatch, NookIdentityHealth,
};
use crate::{TypedInput, TypedOutput};
use nook_core::AuthenticationWorkflowMatch;
use nook_core::SupportedAppLocale;
use nook_core::{
    AppLocale, ProviderFailureCause, ProviderFailureCode, ProviderFailureMessageRequest,
    VaultRecoveryErrorKind,
};
use nook_core::{IdentityHealth, IdentityHealthAssessment};
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
        locale,
        key,
    })
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_vault_recovery_error(message: &str) -> nook_core::VaultRecoveryErrorKind {
    VaultRecoveryErrorKind::classify_vault_recovery_error(message)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn provider_failure_cause(message: &str) -> String {
    ProviderFailureCause::classify(message).label().to_owned()
}

/// The stable code of a caught provider failure, read from the message every
/// export rejects with: a rejected GitHub token or a refused S3 key, from any
/// export, and `Unclassified` for every other failure.
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn provider_failure_code(message: &str) -> ProviderFailureCode {
    ProviderFailureCode::classify(message)
}

/// The translation key of the message a caught provider failure shows: the
/// refusal's own, or the operation's failure key for every other failure.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn provider_failure_translation_key(request: &tsify::Ts<ProviderFailureMessageRequest>) -> Result<String, JsError> {
    let request = request.decode()?;
    Ok(request.translation_key().to_owned())
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
        reason = "FFI boundary: projects the `assess_identity_health` counts through JavaScript Number scalars"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn assess_identity_health(
    copy_provider_count: u32,
    device_join_provider_count: u32,
    device_count: u32,
    stored_item_count: u32,
) -> NookIdentityHealth {
    NookIdentityHealth::from_core(IdentityHealth::assess(IdentityHealthAssessment {
        copy_provider_count: (copy_provider_count as usize).into(),
        device_join_provider_count: (device_join_provider_count as usize).into(),
        device_count: (device_count as usize).into(),
        stored_item_count: (stored_item_count as usize).into(),
    }))
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
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn resolve_app_locale_from_tags(
    tags: Vec<String>,
) -> Result<tsify::Ts<NookAppLocale>, wasm_bindgen::JsError> {
    let result = { SupportedAppLocale::resolve(tags.iter().map(String::as_str)) };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn supported_app_locale_code(
    locale: NookAppLocaleParse,
) -> Result<tsify::Ts<NookAppLocale>, wasm_bindgen::JsError> {
    let result = match locale {
        NookAppLocaleParse::English => Ok(SupportedAppLocale::English),
        NookAppLocaleParse::Russian => Ok(SupportedAppLocale::Russian),
        NookAppLocaleParse::Unsupported => Err(JsError::new(
            "unsupported locale does not have an application locale code",
        )),
    }?;
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn get_translation_catalog(locale: &str) -> String {
    AppLocale::get_translation_catalog(locale).to_owned()
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn lookup_translation(catalog_json: &str, key: &str) -> Result<String, wasm_bindgen::JsError> {
    match TranslationCatalog::lookup_translation(LookupTranslationRequest {
        catalog_json,
        key,
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
        catalog_json,
        locale,
        key,
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
        catalog_json,
        locale,
        key,
        replacements: &replacements,
    })
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn resolve_error_message(catalog_json: &str, locale: &str, message: &str) -> String {
    TranslationCatalog::resolve_error_message(ResolveErrorMessageRequest {
        catalog_json,
        locale,
        message,
    })
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn merge_translation_catalogs(
    base_json: &str,
    overlay_json: &str,
) -> Result<String, wasm_bindgen::JsError> {
    TranslationCatalog::merge_translation_catalogs(MergeTranslationCatalogsRequest {
        base_json,
        overlay_json,
    })
    .map_err(Into::into)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn resolve_translation_catalog(locale: &str, wasm_catalog_json: &str) -> Result<String, wasm_bindgen::JsError> {
    TranslationCatalog::resolve_translation_catalog(ResolveTranslationCatalogRequest {
        locale,
        wasm_catalog_json: TranslationCatalogSource::Supplied(wasm_catalog_json),
    })
    .map_err(Into::into)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn default_translation_catalog(locale: &str) -> String {
    AppLocale::get_translation_catalog(locale).to_owned()
}

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use nook_core::i18n_keys;
    use tsify::Tsify;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn refusals_from_any_export_classify_into_their_stable_codes() -> Result<(), JsError> {
        use crate::NookError;
        use nook_core::S3RequestFailure;
        // Every export rejects with the error's message: for a refusal, its
        // translation key.
        for (error, code, cause) in [
            (
                NookError::S3Request(S3RequestFailure::KeyAccessDenied),
                ProviderFailureCode::S3KeyAccessDenied,
                "forbidden",
            ),
            (
                NookError::GitHubTokenRejected,
                ProviderFailureCode::GitHubTokenRejected,
                "unauthorized",
            ),
        ] {
            let message = error.to_string();
            assert_eq!(provider_failure_code(&message), code);
            assert_eq!(provider_failure_cause(&message), cause);
            let shown = provider_failure_translation_key(&Tsify::into_ts(
                &ProviderFailureMessageRequest {
                    message: message.clone(),
                    operation_failed_key: i18n_keys::PROVIDER_SETUP_S3_LIST_FAILED.to_owned(),
                },
            )?)?;
            assert_eq!(shown, message);
        }
        let other = "S3 request failed with status 503";
        assert_eq!(
            provider_failure_code(other),
            ProviderFailureCode::Unclassified
        );
        let shown =
            provider_failure_translation_key(&Tsify::into_ts(&ProviderFailureMessageRequest {
                message: other.to_owned(),
                operation_failed_key: i18n_keys::PROVIDER_SETUP_S3_LIST_FAILED.to_owned(),
            })?)?;
        assert_eq!(shown, i18n_keys::PROVIDER_SETUP_S3_LIST_FAILED);
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn localization_adapters_project_locales_and_catalog_operations() -> Result<(), JsError> {
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
            resolve_app_locale_from_tags(vec!["xx".into(), "ru".into()])
                .and_then(|value| Ok(value.decode()?))?
                .code(),
            "ru"
        );
        assert_eq!(
            supported_app_locale_code(NookAppLocaleParse::English)
                .and_then(|value| Ok(value.decode()?))?
                .code(),
            "en"
        );
        assert_eq!(
            supported_app_locale_code(NookAppLocaleParse::Russian)
                .and_then(|value| Ok(value.decode()?))?
                .code(),
            "ru"
        );
        assert!(
            supported_app_locale_code(NookAppLocaleParse::Unsupported)
                .and_then(|value| Ok(value.decode()?))
                .is_err()
        );

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
        assert!(resolve_translation_catalog("en", &catalog).is_ok());
        assert!(resolve_translation_catalog("en", "{").is_err());
        assert!(!default_translation_catalog("en").is_empty());
        Ok(())
    }
}
