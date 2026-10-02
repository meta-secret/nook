//! Typed projection of companion-first startup policy.

use super::runtime_policy::NookVaultClientPolicy;
use crate::ConfiguredVaultApplication;
use nook_companion_core::CompanionIdentityStatus;
use nook_core::{
    CompanionProviderPresence, LocalVaultPresence, VaultClientPolicy, VaultCompanionUnlockDecision,
    VaultExistingImportUnlockRequest, VaultStartupUnlockDecision, VaultStartupUnlockRequest,
};
use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Copy, Debug, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
#[tsify(from_wasm_abi)]
pub struct NookVaultStartupUnlockRequest {
    pub local_vault_present: LocalVaultPresence,
    pub companion_provider_present: CompanionProviderPresence,
}

#[wasm_bindgen]
impl NookVaultClientPolicy {
    #[must_use]
    pub fn startup_unlock_decision(
        &self,
        request: NookVaultStartupUnlockRequest,
    ) -> VaultStartupUnlockDecision {
        VaultClientPolicy::startup_unlock_decision(VaultStartupUnlockRequest {
            application: ConfiguredVaultApplication::configured_vault_application(),
            local_vault_present: request.local_vault_present,
            companion_provider_present: request.companion_provider_present,
        })
    }

    #[must_use]
    pub fn existing_vault_import_unlock_decision(
        &self,
        companion_provider_present: CompanionProviderPresence,
    ) -> VaultStartupUnlockDecision {
        VaultClientPolicy::existing_vault_import_unlock_decision(VaultExistingImportUnlockRequest {
            application: ConfiguredVaultApplication::configured_vault_application(),
            companion_provider_present,
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
            policy.startup_unlock_decision(NookVaultStartupUnlockRequest {
                local_vault_present: LocalVaultPresence::Present,
                companion_provider_present: CompanionProviderPresence::Present
            }),
            VaultStartupUnlockDecision::DiscoverCompanion
        );
        assert_eq!(
            policy.startup_unlock_decision(NookVaultStartupUnlockRequest {
                local_vault_present: LocalVaultPresence::Absent,
                companion_provider_present: CompanionProviderPresence::Present
            }),
            VaultStartupUnlockDecision::WebsiteDevice
        );
        assert_eq!(
            policy.startup_unlock_decision(NookVaultStartupUnlockRequest {
                local_vault_present: LocalVaultPresence::Present,
                companion_provider_present: CompanionProviderPresence::Absent
            }),
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

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn existing_import_bridge_discovers_without_local_vault() {
        let policy = NookVaultClientPolicy::new();
        assert_eq!(
            policy.startup_unlock_decision(NookVaultStartupUnlockRequest {
                local_vault_present: LocalVaultPresence::Absent,
                companion_provider_present: CompanionProviderPresence::Present
            }),
            VaultStartupUnlockDecision::WebsiteDevice
        );
        assert_eq!(
            policy.existing_vault_import_unlock_decision(CompanionProviderPresence::Present),
            VaultStartupUnlockDecision::DiscoverCompanion
        );
        assert_eq!(
            policy.existing_vault_import_unlock_decision(CompanionProviderPresence::Absent),
            VaultStartupUnlockDecision::WebsiteDevice
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn startup_request_preserves_generated_enum_representation() -> anyhow::Result<()> {
        let policy = NookVaultClientPolicy::new();
        struct StartupRequestCase {
            provider: CompanionProviderPresence,
            expected: VaultStartupUnlockDecision,
        }
        for case in [
            StartupRequestCase {
                provider: CompanionProviderPresence::Absent,
                expected: VaultStartupUnlockDecision::WebsiteDevice,
            },
            StartupRequestCase {
                provider: CompanionProviderPresence::Present,
                expected: VaultStartupUnlockDecision::DiscoverCompanion,
            },
        ] {
            let value = serde_json::json!({
                "local_vault_present": LocalVaultPresence::Present as u32,
                "companion_provider_present": case.provider as u32,
            });
            let request: NookVaultStartupUnlockRequest = serde_json::from_value(value)?;
            assert_eq!(policy.startup_unlock_decision(request), case.expected);
        }
        for value in [
            serde_json::json!({"local_vault_present": 2, "companion_provider_present": 0}),
            serde_json::json!({"local_vault_present": 1, "companion_provider_present": 2}),
            serde_json::json!({"local_vault_present": 1}),
            serde_json::json!({"local_vault_present": 1, "companion_provider_present": "Absent"}),
        ] {
            assert!(serde_json::from_value::<NookVaultStartupUnlockRequest>(value).is_err());
        }
        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn startup_bridge_uses_immutable_sentinel_application() -> anyhow::Result<()> {
        thread::spawn(|| {
            ConfiguredVaultApplication::configure_vault_application(
                nook_core::VaultApplication::Sentinel,
            );
            assert_eq!(
                NookVaultClientPolicy::new().startup_unlock_decision(
                    NookVaultStartupUnlockRequest {
                        local_vault_present: LocalVaultPresence::Present,
                        companion_provider_present: CompanionProviderPresence::Present
                    }
                ),
                VaultStartupUnlockDecision::WebsiteDevice
            );
        })
        .join()
        .map_err(|_| anyhow::anyhow!("startup policy test thread panicked"))?;
        Ok(())
    }
}
