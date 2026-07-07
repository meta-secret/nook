//! Compatibility exports for enrollment-code key-access payloads.

pub use nook_auth::{
    DecryptedEnrollmentPayload, EnrollmentCodeEnvelope, EnrollmentIssueInput, EnrollmentProvider,
    build_enrollment_link, decrypt_enrollment_payload, encrypt_enrollment_payload,
    normalize_enrollment_code, parse_enrollment_envelope, peek_enrollment_entry_id,
    peek_enrollment_entry_label, peek_enrollment_issued_at,
};
