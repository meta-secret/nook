//! Values sealed as deflated JSON, for payloads with a tight size budget
//! such as a QR-carried onboarding package. Opening bounds the inflated size
//! before any JSON is parsed.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::AppKey;
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AgeArmoredCiphertext, DevicePublicKey};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use serde::{Serialize, de::DeserializeOwned};
use std::io::{Read, Write};
use zeroize::Zeroizing;

const MAX_INFLATED_JSON_BYTES: u64 = 64 * 1024;

impl DevicePublicKey {
    /// Seal a value as deflated JSON to this public key.
    pub fn seal_compressed_json<T: Serialize>(
        &self,
        value: &T,
    ) -> MultiDeviceResult<AgeArmoredCiphertext> {
        let json = Zeroizing::new(
            serde_json::to_vec(value).map_err(|_| MultiDeviceError::InvalidCompressedPayload)?,
        );
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(&json)
            .map_err(|_| MultiDeviceError::InvalidCompressedPayload)?;
        let deflated = Zeroizing::new(
            encoder
                .finish()
                .map_err(|_| MultiDeviceError::InvalidCompressedPayload)?,
        );
        self.seal_bytes(&deflated)
    }
}

impl AppKey {
    /// Open a value sealed with [`DevicePublicKey::seal_compressed_json`].
    pub fn open_compressed_json<T: DeserializeOwned>(
        &self,
        ciphertext: &AgeArmoredCiphertext,
    ) -> MultiDeviceResult<T> {
        let deflated = self.open_sealed_bytes(ciphertext)?;
        let mut json = Zeroizing::new(Vec::new());
        DeflateDecoder::new(deflated.as_slice())
            .take(MAX_INFLATED_JSON_BYTES + 1)
            .read_to_end(&mut json)
            .map_err(|_| MultiDeviceError::InvalidCompressedPayload)?;
        if json.len() as u64 > MAX_INFLATED_JSON_BYTES {
            return Err(MultiDeviceError::InvalidCompressedPayload);
        }
        serde_json::from_slice(&json).map_err(|_| MultiDeviceError::InvalidCompressedPayload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Serialize, serde::Deserialize)]
    struct Row {
        label: String,
    }

    #[test]
    fn compressed_json_round_trips_and_rejects_plain_or_oversized_payloads() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let row = Row {
            label: "GitHub".to_owned(),
        };
        let sealed = key.public_key().seal_compressed_json(&row)?;
        assert_eq!(key.open_compressed_json::<Row>(&sealed)?, row);

        let plain = key.public_key().seal_bytes(&serde_json::to_vec(&row)?)?;
        assert!(matches!(
            key.open_compressed_json::<Row>(&plain),
            Err(MultiDeviceError::InvalidCompressedPayload)
        ));

        let oversized = Row {
            label: " ".repeat(usize::try_from(MAX_INFLATED_JSON_BYTES)?),
        };
        let sealed = key.public_key().seal_compressed_json(&oversized)?;
        assert!(matches!(
            key.open_compressed_json::<Row>(&sealed),
            Err(MultiDeviceError::InvalidCompressedPayload)
        ));
        Ok(())
    }
}
