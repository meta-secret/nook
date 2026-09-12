//! Final-success boundary for access relationships shown by Devices & access.

use crate::NookError;
use crate::storage::device_access;
use nook_core::StoreId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum VerifiedVaultAccessFlow {
    Connect,
    SentinelUnlock,
    EnrollAndConnect,
    EnrollWithKeys,
}

impl VerifiedVaultAccessFlow {
    pub(super) async fn complete<T>(
        self,
        result: Result<T, NookError>,
        device_id: &nook_core::DeviceId,
        store_id: &str,
    ) -> Result<T, NookError> {
        let value = result?;
        tracing::debug!(flow = ?self, "verified vault access completed");
        let Ok(store_id) = StoreId::parse(store_id) else {
            return Ok(value);
        };
        // Dashboard metadata is descriptive and must not turn a successful,
        // cryptographically verified unlock or enrollment into a failure.
        drop(
            device_access::VerifiedVaultAccessUpdate {
                device_id,
                store_id: &store_id,
            }
            .apply()
            .await,
        );
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::device_access::DeviceAccessProfileKey;
    use nook_core::DeviceId;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn requested_flows_record_only_after_the_final_fallible_step() -> Result<(), NookError> {
        let device_id = DeviceId::parse("0123456789abcdef")
            .map_err(|error| NookError::Database(error.to_string()))?;
        for flow in [
            VerifiedVaultAccessFlow::SentinelUnlock,
            VerifiedVaultAccessFlow::EnrollAndConnect,
            VerifiedVaultAccessFlow::EnrollWithKeys,
        ] {
            DeviceAccessProfileKey::clear_companion().await?;
            let failure = flow
                .complete::<()>(
                    Err(NookError::Database(
                        "failure immediately before access recording".to_owned(),
                    )),
                    &device_id,
                    "store_testtoken11",
                )
                .await;
            assert!(failure.is_err());
            assert!(
                DeviceAccessProfileKey::companion()
                    .load()
                    .await?
                    .verified_vaults
                    .is_empty()
            );

            flow.complete(Ok(()), &device_id, "store_testtoken11")
                .await?;
            // This unregistered device records into the companion profile,
            // independently of a protected identity selected by another test.
            let profile = DeviceAccessProfileKey::companion().load().await?;
            assert_eq!(profile.verified_vaults.len(), 1);
            assert_eq!(profile.verified_vaults[0].device_id, device_id);
            assert_eq!(
                profile.verified_vaults[0].store_id.as_str(),
                "store_testtoken11"
            );
        }

        DeviceAccessProfileKey::clear_companion().await?;
        Ok(())
    }
}
