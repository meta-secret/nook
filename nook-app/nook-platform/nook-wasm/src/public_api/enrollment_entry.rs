use super::wasm_bindgen;
use crate::{NookDecryptedEnrollmentPayload, NookEnrollmentIssueInput};
use nook_core::EnrollmentEntryLabel;
use wasm_bindgen::JsError;

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
            EnrollmentEntryLabel::Unlabeled => NookEnrollmentEntryLabelState::Unlabeled,
            EnrollmentEntryLabel::Labeled(_) => NookEnrollmentEntryLabelState::Labeled,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            EnrollmentEntryLabel::Unlabeled => {
                Err(JsError::new("enrollment entry does not have a label"))
            }
            EnrollmentEntryLabel::Labeled(label) => Ok(label.clone()),
        }
    }
}

#[wasm_bindgen]
pub fn peek_enrollment_entry_id(code: &str) -> Result<String, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(nook_core::peek_enrollment_entry_id(&code)?)
}

#[wasm_bindgen]
pub fn peek_enrollment_entry_label(
    code: &str,
) -> Result<NookEnrollmentEntryLabel, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(NookEnrollmentEntryLabel(
        nook_core::peek_enrollment_entry_label(&code)?,
    ))
}

#[wasm_bindgen]
pub fn peek_enrollment_issued_at(code: &str) -> Result<String, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(nook_core::peek_enrollment_issued_at(&code)?)
}

#[wasm_bindgen]
pub fn encrypt_unlabeled_enrollment_payload(
    input: &NookEnrollmentIssueInput,
    password: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::encrypt_enrollment_payload(
        &input.to_core()?,
        password,
        "",
    )?)
}

#[wasm_bindgen]
pub fn encrypt_labeled_enrollment_payload(
    input: &NookEnrollmentIssueInput,
    password: &str,
    entry_label: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::encrypt_enrollment_payload(
        &input.to_core()?,
        password,
        entry_label,
    )?)
}

#[wasm_bindgen]
pub fn decrypt_enrollment_payload(
    code: &str,
    password: &str,
) -> Result<NookDecryptedEnrollmentPayload, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(NookDecryptedEnrollmentPayload::from_core(
        nook_core::decrypt_enrollment_payload(&code, password)?,
    ))
}

#[wasm_bindgen]
#[must_use]
pub fn build_enrollment_link(code: &str, base_url: &str) -> String {
    nook_core::build_enrollment_link(code, base_url)
}

#[wasm_bindgen]
pub fn build_sentinel_genesis_request_link(
    request_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::build_sentinel_genesis_request_link(
        request_json,
        base_url,
    )?)
}

#[wasm_bindgen]
pub fn normalize_sentinel_genesis_request(input: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_sentinel_genesis_request(input)?)
}

#[wasm_bindgen]
pub fn build_sentinel_genesis_participant_response_link(
    response_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::build_sentinel_genesis_participant_response_link(
        response_json,
        base_url,
    )?)
}

#[wasm_bindgen]
pub fn normalize_sentinel_genesis_participant_payload(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_sentinel_genesis_participant_payload(
        input,
    )?)
}

#[wasm_bindgen]
pub fn sentinel_genesis_participant_fingerprint(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sentinel_genesis_participant_fingerprint(input)?)
}

#[wasm_bindgen]
#[must_use]
pub fn normalize_enrollment_code(code: &str) -> String {
    nook_core::normalize_enrollment_code(code)
}
