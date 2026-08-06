use super::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookEnrollmentEntryLabelState {
    Unlabeled,
    Labeled,
}

#[wasm_bindgen]
pub struct NookEnrollmentEntryLabel(nook_core::EnrollmentEntryLabel);

#[wasm_bindgen]
impl NookEnrollmentEntryLabel {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookEnrollmentEntryLabelState {
        match &self.0 {
            nook_core::EnrollmentEntryLabel::Unlabeled => NookEnrollmentEntryLabelState::Unlabeled,
            nook_core::EnrollmentEntryLabel::Labeled(_) => NookEnrollmentEntryLabelState::Labeled,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::EnrollmentEntryLabel::Unlabeled => Err(wasm_bindgen::JsError::new(
                "enrollment entry does not have a label",
            )),
            nook_core::EnrollmentEntryLabel::Labeled(label) => Ok(label.clone()),
        }
    }
}

#[wasm_bindgen(js_name = peekEnrollmentEntryId)]
pub fn peek_enrollment_entry_id(code: &str) -> Result<String, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(nook_core::peek_enrollment_entry_id(&code)?)
}

#[wasm_bindgen(js_name = peekEnrollmentEntryLabel)]
pub fn peek_enrollment_entry_label(
    code: &str,
) -> Result<NookEnrollmentEntryLabel, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(NookEnrollmentEntryLabel(
        nook_core::peek_enrollment_entry_label(&code)?,
    ))
}

#[wasm_bindgen(js_name = peekEnrollmentIssuedAt)]
pub fn peek_enrollment_issued_at(code: &str) -> Result<String, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(nook_core::peek_enrollment_issued_at(&code)?)
}
