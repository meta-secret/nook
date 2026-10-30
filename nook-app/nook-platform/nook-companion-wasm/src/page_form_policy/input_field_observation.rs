//! Typed WASM binding for one browser-observed input field and its field policy exports.

use nook_page_policy::{
    OneTimeCodeEntryEvidence, OneTimeCodeEntrySignals, PageInputType, PageSecondFactorRoute,
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct NookPageInputFieldObservation {
    inner: nook_page_policy::PageInputFieldObservation,
}

impl NookPageInputFieldObservation {
    pub(crate) const fn as_core(&self) -> &nook_page_policy::PageInputFieldObservation {
        &self.inner
    }
}

/// Migration decision: producers and the offscreen consumer ship the entry-signal arguments
/// atomically; mixed-version calls are unsupported and fail closed (no defaults or compat branch).
#[wasm_bindgen]
impl NookPageInputFieldObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: converts the DOM maxLength (-1 when absent) into PageInputMaxLength"
        )
    )]
    pub fn new(
        input_type: PageInputType,
        disabled: bool,
        read_only: bool,
        autocomplete_tokens: Vec<String>,
        identity_text: String,
        login_context: bool,
        second_factor_route: PageSecondFactorRoute,
        input_mode: String,
        max_length: i32,
        pattern: String,
    ) -> Self {
        Self {
            inner: nook_page_policy::PageInputFieldObservation {
                input_type,
                disabled,
                read_only,
                autocomplete_tokens,
                identity_text,
                login_context: login_context.into(),
                one_time_code_entry: OneTimeCodeEntryEvidence::Observed(OneTimeCodeEntrySignals {
                    second_factor_route,
                    input_mode: input_mode.as_str().into(),
                    max_length: max_length.into(),
                    pattern: pattern.as_str().into(),
                }),
            },
        }
    }
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_username_field(field: &NookPageInputFieldObservation) -> bool {
    field.inner.looks_like_username_field()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn looks_like_one_time_code_field(field: &NookPageInputFieldObservation) -> bool {
    field.inner.looks_like_one_time_code_field()
}

#[cfg(test)]
mod tests {
    use super::super::{NookLoginContextObservation, second_factor_route};
    use super::*;
    use nook_page_policy::{PageInputMaxLength, PageInputMode, PageInputPattern};

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn second_factor_route_export_and_entry_arguments_reach_core_policy() {
        let route = |path: &str| {
            second_factor_route(&NookLoginContextObservation::new(
                "aspnetForm".to_owned(),
                Vec::new(),
                "Submit".to_owned(),
                path.to_owned(),
            ))
        };
        assert_eq!(
            route("/twofa/totp/ www.namecheap.com"),
            PageSecondFactorRoute::SecondFactor
        );
        assert_eq!(
            route("/twofa/setup example.test"),
            PageSecondFactorRoute::Unrelated
        );

        let field = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            Vec::new(),
            "ctl00$MainContent$txtValue".to_owned(),
            false,
            PageSecondFactorRoute::SecondFactor,
            " numeric ".to_owned(),
            -1,
            r"\d{6}".to_owned(),
        );
        assert_eq!(
            field.as_core().one_time_code_entry,
            OneTimeCodeEntryEvidence::Observed(OneTimeCodeEntrySignals {
                second_factor_route: PageSecondFactorRoute::SecondFactor,
                input_mode: PageInputMode::Numeric,
                max_length: PageInputMaxLength::Absent,
                pattern: PageInputPattern::Digits,
            })
        );
        assert!(looks_like_one_time_code_field(&field));
    }
}
