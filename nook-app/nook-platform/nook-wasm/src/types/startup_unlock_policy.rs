//! Typed projection of companion-first startup policy.

use super::runtime_policy::NookVaultClientPolicy;
use crate::ConfiguredVaultApplication;
use nook_companion_core::CompanionIdentityStatus;
use nook_core::{
    LocalVaultPresence, VaultClientPolicy, VaultCompanionUnlockDecision,
    VaultStartupUnlockDecision, VaultStartupUnlockRequest,
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultClientPolicy {
    #[must_use]
    pub fn startup_unlock_decision(
        &self,
        local_vault_present: LocalVaultPresence,
    ) -> VaultStartupUnlockDecision {
        VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
            application: ConfiguredVaultApplication::configured_vault_application(),
            local_vault_present,
        })
    }

    /// Supply the canonical response accepted by companion discovery admission.
    /// Transport, decoding, and admission failures must remain failures.
    #[must_use]
    pub fn companion_unlock_decision(
        &self,
        status: &CompanionIdentityStatus,
    ) -> VaultCompanionUnlockDecision {
        VaultClientPolicy::companion_unlock_decision(status)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    #[cfg(not(target_arch = "wasm32"))]
    use std::thread;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn typed_bridge_preserves_companion_priority_and_admitted_absence() {
        let policy = NookVaultClientPolicy::new();
        assert_eq!(
            policy.startup_unlock_decision(LocalVaultPresence::Present),
            VaultStartupUnlockDecision::DiscoverCompanion
        );
        assert_eq!(
            policy.startup_unlock_decision(LocalVaultPresence::Absent),
            VaultStartupUnlockDecision::WebsiteDevice
        );
        assert_eq!(
            policy.companion_unlock_decision(&CompanionIdentityStatus::Locked {
                request_id: "startup-discovery".to_owned(),
                vault_store_id: "store_startup".to_owned(),
            }),
            VaultCompanionUnlockDecision::CompanionDevice
        );
        assert_eq!(
            policy.companion_unlock_decision(&CompanionIdentityStatus::Unavailable {
                request_id: "startup-discovery".to_owned(),
                vault_store_id: "store_startup".to_owned(),
            }),
            VaultCompanionUnlockDecision::WebsiteDevice
        );
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn startup_bridge_uses_immutable_sentinel_application() -> anyhow::Result<()> {
        thread::spawn(|| {
            ConfiguredVaultApplication::configure_vault_application(
                nook_core::VaultApplication::Sentinel,
            );
            assert_eq!(
                NookVaultClientPolicy::new().startup_unlock_decision(LocalVaultPresence::Present),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        })
        .join()
        .map_err(|_| anyhow::anyhow!("startup policy test thread panicked"))?;
        Ok(())
    }
}
