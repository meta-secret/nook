//! Typed WASM binding for second-factor route evidence.

use super::NookLoginContextObservation;
use nook_companion_core::PageSecondFactorRoute;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn has_second_factor_route(observation: &NookLoginContextObservation) -> bool {
    matches!(observation.inner.second_factor_route(), PageSecondFactorRoute::SecondFactor)
}

#[cfg(test)]
mod tests {
    use super::super::{NookPageInputFieldObservation, looks_like_one_time_code_field};
    use super::*;
    use nook_companion_core::{
        OneTimeCodeEntryEvidence, OneTimeCodeEntrySignals, PageInputMaxLength, PageInputMode,
        PageInputPattern, PageInputType,
    };

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn second_factor_route_export_and_entry_arguments_reach_core_policy() {
        let route = |path: &str| {
            has_second_factor_route(&NookLoginContextObservation::new(
                "aspnetForm".to_owned(),
                Vec::new(),
                "Submit".to_owned(),
                path.to_owned(),
            ))
        };
        assert!(route("/twofa/totp/ www.namecheap.com"));
        assert!(!route("/settings/two-factor/setup github.com"));

        let field = NookPageInputFieldObservation::new(
            PageInputType::Text,
            false,
            false,
            Vec::new(),
            "ctl00$MainContent$txtValue".to_owned(),
            false,
            true,
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
