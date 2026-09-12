use super::wasm_bindgen;
use crate::{NookDecryptedEnrollmentPayload, NookEnrollmentIssueInput};
use nook_core::{
    CheckedEnrollmentEnvelope, CheckedEnrollmentIssuance, EnrollmentEntryLabel, EnrollmentIssuance,
    EnrollmentLinkInput,
};
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn peek_enrollment_entry_id(code: &str) -> Result<String, wasm_bindgen::JsError> {
    let code = EnrollmentLinkInput { input: code }.normalize();
    Ok(CheckedEnrollmentEnvelope::parse(&code)
        .map(|checked| checked.envelope().entry_id.clone())?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn peek_enrollment_entry_label(
    code: &str,
) -> Result<NookEnrollmentEntryLabel, wasm_bindgen::JsError> {
    let code = EnrollmentLinkInput { input: code }.normalize();
    Ok(NookEnrollmentEntryLabel(
        CheckedEnrollmentEnvelope::parse(&code)
            .map(|checked| checked.envelope().entry_label.clone())?,
    ))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn peek_enrollment_issued_at(code: &str) -> Result<String, wasm_bindgen::JsError> {
    let code = EnrollmentLinkInput { input: code }.normalize();
    Ok(CheckedEnrollmentEnvelope::parse(&code)
        .map(|checked| checked.envelope().issued_at.clone())?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn encrypt_unlabeled_enrollment_payload(
    input: &NookEnrollmentIssueInput,
    password: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(EnrollmentIssuance {
        input: &input.to_core()?,
        password,
        entry_label: "",
    }
    .check()
    .and_then(CheckedEnrollmentIssuance::issue)?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn encrypt_labeled_enrollment_payload(
    input: &NookEnrollmentIssueInput,
    password: &str,
    entry_label: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(EnrollmentIssuance {
        input: &input.to_core()?,
        password,
        entry_label,
    }
    .check()
    .and_then(CheckedEnrollmentIssuance::issue)?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decrypt_enrollment_payload(
    code: &str,
    password: &str,
) -> Result<NookDecryptedEnrollmentPayload, wasm_bindgen::JsError> {
    let code = EnrollmentLinkInput { input: code }.normalize();
    Ok(NookDecryptedEnrollmentPayload::from_core(
        CheckedEnrollmentEnvelope::parse(&code)?.decrypt(password)?,
    ))
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn build_enrollment_link(code: &str, base_url: &str) -> String {
    EnrollmentLinkInput { input: code }.link(base_url)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn build_sentinel_genesis_request_link(
    request_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok((nook_core::SentinelGenesisLinkInput {
        input: request_json,
    })
    .request_link(base_url)?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn normalize_sentinel_genesis_request(input: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok((nook_core::SentinelGenesisLinkInput { input }).canonical_request()?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn build_sentinel_genesis_participant_response_link(
    response_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok((nook_core::SentinelGenesisLinkInput {
        input: response_json,
    })
    .response_link(base_url)?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn normalize_sentinel_genesis_participant_payload(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok((nook_core::SentinelGenesisLinkInput { input }).canonical_response()?)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn sentinel_genesis_participant_fingerprint(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok((nook_core::SentinelGenesisLinkInput { input }).reported_fingerprint()?)
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn normalize_enrollment_code(code: &str) -> String {
    EnrollmentLinkInput { input: code }.normalize()
}

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use crate::NookEnrollmentProvider;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn enrollment_labels_links_and_normalization_project_typed_values() {
        let unlabeled = NookEnrollmentEntryLabel(EnrollmentEntryLabel::Unlabeled);
        assert_eq!(unlabeled.state(), NookEnrollmentEntryLabelState::Unlabeled);
        assert!(unlabeled.value().is_err());
        let labeled = NookEnrollmentEntryLabel(EnrollmentEntryLabel::Labeled("Work".into()));
        assert_eq!(labeled.state(), NookEnrollmentEntryLabelState::Labeled);
        assert_eq!(labeled.value().unwrap(), "Work");

        assert_eq!(normalize_enrollment_code(" ab-cd \n"), "ab-cd");
        assert_eq!(
            build_enrollment_link("CODE", "https://example.test/"),
            "https://example.test/#enroll=CODE"
        );
        assert!(peek_enrollment_entry_id("not-a-code").is_err());
        assert!(peek_enrollment_entry_label("not-a-code").is_err());
        assert!(peek_enrollment_issued_at("not-a-code").is_err());
        assert!(build_sentinel_genesis_request_link("{}", "https://example.test").is_err());
        assert!(normalize_sentinel_genesis_request("{}\n").is_err());
        assert!(
            build_sentinel_genesis_participant_response_link("{}", "https://example.test").is_err()
        );
        assert!(normalize_sentinel_genesis_participant_payload("{}\n").is_err());
        assert!(sentinel_genesis_participant_fingerprint("{}").is_err());
    }

    #[wasm_bindgen_test]
    fn enrollment_payload_round_trip_preserves_label_and_metadata() -> Result<(), JsError> {
        let input = NookEnrollmentIssueInput::named(
            NookEnrollmentProvider::local(),
            "Work".into(),
            "entry-1".into(),
            "2026-01-01".into(),
        );
        let unlabeled = encrypt_unlabeled_enrollment_payload(&input, "password")?;
        let decoded = decrypt_enrollment_payload(&unlabeled, "password")?;
        assert_eq!(decoded.vault_name(), "Work");
        assert_eq!(decoded.entry_id(), "entry-1");
        assert_eq!(decoded.issued_at(), "2026-01-01");

        let labeled = encrypt_labeled_enrollment_payload(&input, "password", "Phone")?;
        let normalized = normalize_enrollment_code(&labeled);
        assert_eq!(peek_enrollment_entry_label(&normalized)?.value()?, "Phone");
        Ok(())
    }
}
