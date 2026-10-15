//! The provider row an onboarding package carries: deflated before it is
//! sealed, so the package stays within its encoded budget.
use crate::{MultiDeviceError, StorageProviderData};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use std::io::{Read, Write};
use zeroize::Zeroizing;

const MAX_PROVIDER_ROW_BYTES: u64 = 48 * 1024;

pub(super) struct ProviderRowPayload;

impl ProviderRowPayload {
    /// Deflated row JSON ready to be sealed.
    pub(super) fn encode(
        provider: &StorageProviderData,
    ) -> Result<Zeroizing<Vec<u8>>, MultiDeviceError> {
        let json = Zeroizing::new(
            serde_json::to_vec(provider)
                .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?,
        );
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(&json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        Ok(Zeroizing::new(encoder.finish().map_err(|_| {
            MultiDeviceError::InvalidSentinelGenesisPayload
        })?))
    }

    /// The row an opened payload carries. The inflated size is bounded
    /// before any JSON is parsed.
    pub(super) fn decode(opened: &[u8]) -> Result<StorageProviderData, MultiDeviceError> {
        let mut json = Zeroizing::new(Vec::new());
        DeflateDecoder::new(opened)
            .take(MAX_PROVIDER_ROW_BYTES + 1)
            .read_to_end(&mut json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if json.len() as u64 > MAX_PROVIDER_ROW_BYTES {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        serde_json::from_slice(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_round_trips_and_rejects_plain_or_oversized_input() -> anyhow::Result<()> {
        let provider = StorageProviderData::github("github", "GitHub", "pat", "owner/repo", "now");
        let encoded = ProviderRowPayload::encode(&provider)?;
        assert_eq!(ProviderRowPayload::decode(&encoded)?, provider);
        assert!(ProviderRowPayload::decode(&serde_json::to_vec(&provider)?).is_err());

        let oversized = vec![b' '; usize::try_from(MAX_PROVIDER_ROW_BYTES + 1)?];
        let mut deflater = DeflateEncoder::new(Vec::new(), Compression::best());
        deflater.write_all(&oversized)?;
        assert!(ProviderRowPayload::decode(&deflater.finish()?).is_err());
        Ok(())
    }
}
