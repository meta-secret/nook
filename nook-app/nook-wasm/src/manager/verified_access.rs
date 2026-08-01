//! Final-success boundary for access relationships shown by Devices & access.

use crate::NookError;

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
        device_id: &str,
        store_id: &str,
    ) -> Result<T, NookError> {
        let value = result?;
        tracing::debug!(flow = ?self, "verified vault access completed");
        // Dashboard metadata is descriptive and must not turn a successful,
        // cryptographically verified unlock or enrollment into a failure.
        let _ =
            crate::storage::device_access::record_verified_vault_access(device_id, store_id).await;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn requested_flows_record_only_after_the_final_fallible_step() -> Result<(), NookError> {
        for flow in [
            VerifiedVaultAccessFlow::SentinelUnlock,
            VerifiedVaultAccessFlow::EnrollAndConnect,
            VerifiedVaultAccessFlow::EnrollWithKeys,
        ] {
            crate::storage::device_access::delete_device_access_profile().await?;
            let failure = flow
                .complete::<()>(
                    Err(NookError::Database(
                        "failure immediately before access recording".to_owned(),
                    )),
                    "device-under-test",
                    "store-under-test",
                )
                .await;
            assert!(failure.is_err());
            assert!(
                crate::storage::device_access::load_device_access_profile()
                    .await?
                    .verified_vaults
                    .is_empty()
            );

            flow.complete(Ok(()), "device-under-test", "store-under-test")
                .await?;
            let profile = crate::storage::device_access::load_device_access_profile().await?;
            assert_eq!(profile.verified_vaults.len(), 1);
            assert_eq!(profile.verified_vaults[0].device_id, "device-under-test");
            assert_eq!(profile.verified_vaults[0].store_id, "store-under-test");
        }

        crate::storage::device_access::delete_device_access_profile().await?;
        Ok(())
    }
}
