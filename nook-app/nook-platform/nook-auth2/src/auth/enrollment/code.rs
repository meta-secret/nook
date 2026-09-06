#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Password-encrypted enrollment envelope representation and key derivation.
use super::EnrollmentCodeEnvelope;
use crate::{EnrollmentError, EnrollmentKeyDerivationIterations, EnrollmentResult};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use pbkdf2::{pbkdf2_hmac, sha2::Sha256};
mod admission;
mod issuance;
mod links;
pub use admission::CheckedEnrollmentEnvelope;
pub use issuance::{CheckedEnrollmentIssuance, EnrollmentIssuance};
pub use links::EnrollmentLinkInput;

const PBKDF2_ITERATIONS: u32 = 210_000;
const SALT_LEN: usize = 16;
const IV_LEN: usize = 12;
const KEY_LEN: usize = 32;
const ENROLLMENT_KDF: &str = "pbkdf2-sha256";
const ENROLLMENT_CIPHER: &str = "aes-gcm-256";

struct EnrollmentKeyDerivation<'a> {
    password: &'a str,
    salt: &'a [u8],
    iterations: EnrollmentKeyDerivationIterations,
}
impl EnrollmentKeyDerivation<'_> {
    fn derive(self) -> [u8; KEY_LEN] {
        let mut key = [0u8; KEY_LEN];
        pbkdf2_hmac::<Sha256>(
            self.password.as_bytes(),
            self.salt,
            self.iterations.into(),
            &mut key,
        );
        key
    }
}
impl EnrollmentCodeEnvelope {
    fn encode(&self) -> EnrollmentResult<String> {
        let encoded = serde_json::to_vec(self).map_err(EnrollmentError::Serialize)?;
        Ok(Engine::encode(&URL_SAFE_NO_PAD, encoded.as_slice()))
    }
}
