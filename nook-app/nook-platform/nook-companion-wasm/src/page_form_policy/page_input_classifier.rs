//! Plain-object policy projections for the direct and offscreen browser hosts.

use nook_companion_core::{
    BrowserPageInput, IndexedPageInputClassification, LoginContextObservation,
    PageInputClassification, PageInputContext, PageInputFieldRequest, PageInputLabel,
    PageInputsClassification, PageInputsObservation,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookPageInputClassifier;

impl NookPageInputClassifier {
    fn conversion_error(_: tsify::Error) -> JsError {
        JsError::new("Typed WASM value could not be converted.")
    }
}

#[wasm_bindgen]
impl NookPageInputClassifier {
    pub fn classify_page_inputs(
        input: &Ts<PageInputsObservation>,
    ) -> Result<Ts<PageInputsClassification>, JsError> {
        let input = input.to_rust().map_err(Self::conversion_error)?;
        input.classify().into_ts().map_err(Self::conversion_error)
    }

    pub fn classify_page_input(
        input: &Ts<PageInputFieldRequest>,
    ) -> Result<Ts<IndexedPageInputClassification>, JsError> {
        let input = input.to_rust().map_err(Self::conversion_error)?;
        input.classify().into_ts().map_err(Self::conversion_error)
    }

    pub fn classify_field(
        input: &Ts<BrowserPageInput>,
    ) -> Result<Ts<PageInputClassification>, JsError> {
        let input = input.to_rust().map_err(Self::conversion_error)?;
        input.classify().into_ts().map_err(Self::conversion_error)
    }

    pub fn classify_context(
        input: &Ts<LoginContextObservation>,
    ) -> Result<Ts<PageInputContext>, JsError> {
        let input = input.to_rust().map_err(Self::conversion_error)?;
        PageInputContext::from(&input)
            .into_ts()
            .map_err(Self::conversion_error)
    }

    pub fn classify_label(input: &Ts<PageInputLabel>) -> Result<bool, JsError> {
        Ok(input.to_rust().map_err(Self::conversion_error)?.matches())
    }
}
