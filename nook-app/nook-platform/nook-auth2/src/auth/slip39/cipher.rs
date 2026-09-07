#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use pbkdf2::{pbkdf2_hmac, sha2::Sha256 as Pbkdf2Sha256};
use zeroize::Zeroize;

use crate::errors::{MultiDeviceError, MultiDeviceResult};

use super::{ROUND_COUNT, ROUND_ITERATIONS, SECRET_BYTES};

pub(super) struct MasterSecretCipher<'a> {
    passphrase: &'a [u8],
    exponent: u8,
}

impl<'a> MasterSecretCipher<'a> {
    pub(super) fn new(passphrase: &'a [u8], exponent: u8) -> Self {
        Self {
            passphrase,
            exponent,
        }
    }

    pub(super) fn encrypt(&self, secret: &[u8]) -> Vec<u8> {
        self.feistel(secret, 0..ROUND_COUNT)
    }

    pub(super) fn decrypt(&self, encrypted: &[u8]) -> MultiDeviceResult<Vec<u8>> {
        if encrypted.len() != SECRET_BYTES || !encrypted.len().is_multiple_of(2) {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding);
        }
        Ok(self.feistel(encrypted, (0..ROUND_COUNT).rev()))
    }

    fn feistel(&self, input: &[u8], rounds: impl Iterator<Item = u8>) -> Vec<u8> {
        let middle = input.len() / 2;
        let mut left = input[..middle].to_vec();
        let mut right = input[middle..].to_vec();
        for round in rounds {
            let mut derived = self.round(round, &right);
            let next_right = Self::xor(&left, &derived);
            left.zeroize();
            left = right;
            right = next_right;
            derived.zeroize();
        }
        let mut output = right;
        output.extend_from_slice(&left);
        left.zeroize();
        output
    }

    fn round(&self, round: u8, right: &[u8]) -> Vec<u8> {
        let mut password = Vec::with_capacity(self.passphrase.len() + 1);
        password.push(round);
        password.extend_from_slice(self.passphrase);
        let iterations = ROUND_ITERATIONS << self.exponent;
        let mut output = vec![0_u8; right.len()];
        // `ext = 1` means the identifier is not part of the salt prefix.
        pbkdf2_hmac::<Pbkdf2Sha256>(&password, right, iterations, &mut output);
        password.zeroize();
        output
    }

    fn xor(left: &[u8], right: &[u8]) -> Vec<u8> {
        left.iter().zip(right).map(|(a, b)| a ^ b).collect()
    }
}
