//! Bounded wire encoding for untrusted onboarding package DTOs.
use super::SentinelOnboardingPackage;
use crate::MultiDeviceError;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use std::io::{Read, Write};
const MAX_ENCODED_PACKAGE_BYTES: usize = 16 * 1024;
const MAX_DECOMPRESSED_PACKAGE_BYTES: u64 = 64 * 1024;
impl SentinelOnboardingPackage {
    pub fn encode(&self) -> Result<String, MultiDeviceError> {
        let package = self;

        let json = serde_json::to_vec(package)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(&json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        let compressed = encoder
            .finish()
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        Ok(Engine::encode(&URL_SAFE_NO_PAD, compressed))
    }
    pub fn decode(encoded: &str) -> Result<Self, MultiDeviceError> {
        let encoded = encoded.trim();
        if encoded.is_empty() || encoded.len() > MAX_ENCODED_PACKAGE_BYTES {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        let compressed = Engine::decode(&URL_SAFE_NO_PAD, encoded)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        let mut decoder = DeflateDecoder::new(compressed.as_slice());
        let mut json = Vec::new();
        decoder
            .by_ref()
            .take(MAX_DECOMPRESSED_PACKAGE_BYTES + 1)
            .read_to_end(&mut json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if json.len() as u64 > MAX_DECOMPRESSED_PACKAGE_BYTES {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        serde_json::from_slice(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}
#[cfg(test)]
mod tests {
    use super::{MAX_DECOMPRESSED_PACKAGE_BYTES, SentinelOnboardingPackage};
    use crate::MultiDeviceError;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use flate2::{Compression, write::DeflateEncoder};
    use std::io::Write;
    #[test]
    fn oversized_onboarding_payload_is_rejected_before_deserialization() -> anyhow::Result<()> {
        let oversized_len = usize::try_from(MAX_DECOMPRESSED_PACKAGE_BYTES + 1)?;
        let oversized = vec![b'x'; oversized_len];
        let mut deflater = DeflateEncoder::new(Vec::new(), Compression::best());
        deflater.write_all(&oversized)?;
        let compressed_payload = Engine::encode(&URL_SAFE_NO_PAD, deflater.finish()?);

        assert!(matches!(
            SentinelOnboardingPackage::decode(&compressed_payload),
            Err(MultiDeviceError::InvalidSentinelGenesisPayload)
        ));
        Ok(())
    }

    struct EncodedPackageFixture {
        json: Vec<u8>,
    }
    impl EncodedPackageFixture {
        fn encode(self) -> anyhow::Result<String> {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
            encoder.write_all(&self.json)?;
            Ok(Engine::encode(&URL_SAFE_NO_PAD, encoder.finish()?))
        }
    }

    #[test]
    fn codec_rejects_empty_invalid_and_oversized_encoded_inputs() {
        for encoded in [
            String::new(),
            " ".to_owned(),
            "!".to_owned(),
            "a".repeat(super::MAX_ENCODED_PACKAGE_BYTES + 1),
        ] {
            assert!(matches!(
                SentinelOnboardingPackage::decode(&encoded),
                Err(MultiDeviceError::InvalidSentinelGenesisPayload)
            ));
        }
    }

    #[test]
    fn codec_preserves_outer_whitespace_and_rejects_invalid_json() -> anyhow::Result<()> {
        use super::super::tests::OnboardingFixture;
        let fixture = OnboardingFixture::new()?;
        let package = fixture.package()?;
        assert_eq!(
            SentinelOnboardingPackage::decode(&format!(" \n{}\t", package.encode()?))?,
            package
        );
        for json in [
            b"not-json".to_vec(),
            b"{}".to_vec(),
            br#"{"version":2}"#.to_vec(),
        ] {
            let encoded = EncodedPackageFixture { json }.encode()?;
            assert!(matches!(
                SentinelOnboardingPackage::decode(&encoded),
                Err(MultiDeviceError::InvalidSentinelGenesisPayload)
            ));
        }
        Ok(())
    }

    #[test]
    fn decompressed_limit_accepts_exact_boundary() -> anyhow::Result<()> {
        use super::super::tests::OnboardingFixture;
        let package = OnboardingFixture::new()?.package()?;
        let mut json = serde_json::to_vec(&package)?;
        json.resize(usize::try_from(MAX_DECOMPRESSED_PACKAGE_BYTES)?, b' ');
        let encoded = EncodedPackageFixture { json }.encode()?;
        assert_eq!(SentinelOnboardingPackage::decode(&encoded)?, package);
        Ok(())
    }
}
