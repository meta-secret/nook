//! Vault-safety recommendations shared by every host application.

/// Missing safeguards that should be presented to an unlocked vault user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VaultSecurityRecommendations {
    pub needs_sync_provider: bool,
    pub needs_another_device: bool,
}

/// Named values required by `VaultSecurityRecommendations::assess_vault_security`.
#[derive(Clone, Copy)]
pub struct VaultSecurityAssessment {
    pub sync_provider_count: crate::VaultSyncProviderCount,
    pub enrolled_device_count: crate::EnrolledDeviceCount,
}

impl VaultSecurityRecommendations {
    #[must_use]
    pub const fn has_recommendations(self) -> bool {
        self.needs_sync_provider || self.needs_another_device
    }
}

/// Assess whether the vault has independent data-replication and access safeguards.
impl VaultSecurityRecommendations {
    #[must_use]
    pub const fn assess_vault_security(
        request: VaultSecurityAssessment,
    ) -> VaultSecurityRecommendations {
        let VaultSecurityAssessment {
            sync_provider_count,
            enrolled_device_count,
        } = request;
        VaultSecurityRecommendations {
            needs_sync_provider: sync_provider_count.is_zero(),
            needs_another_device: enrolled_device_count.is_at_most_one(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommends_both_safeguards_for_a_single_device_local_vault() {
        let recommendations =
            VaultSecurityRecommendations::assess_vault_security(VaultSecurityAssessment {
                sync_provider_count: 0.into(),
                enrolled_device_count: 1.into(),
            });

        assert!(recommendations.needs_sync_provider);
        assert!(recommendations.needs_another_device);
        assert!(recommendations.has_recommendations());
    }

    #[test]
    fn keeps_device_recovery_recommendation_after_sync_is_configured() {
        let recommendations =
            VaultSecurityRecommendations::assess_vault_security(VaultSecurityAssessment {
                sync_provider_count: 1.into(),
                enrolled_device_count: 1.into(),
            });

        assert!(!recommendations.needs_sync_provider);
        assert!(recommendations.needs_another_device);
        assert!(recommendations.has_recommendations());
    }

    #[test]
    fn keeps_replication_recommendation_after_another_device_is_enrolled() {
        let recommendations =
            VaultSecurityRecommendations::assess_vault_security(VaultSecurityAssessment {
                sync_provider_count: 0.into(),
                enrolled_device_count: 2.into(),
            });

        assert!(recommendations.needs_sync_provider);
        assert!(!recommendations.needs_another_device);
        assert!(recommendations.has_recommendations());
    }

    #[test]
    fn clears_recommendations_only_when_both_safeguards_are_present() {
        let recommendations =
            VaultSecurityRecommendations::assess_vault_security(VaultSecurityAssessment {
                sync_provider_count: 1.into(),
                enrolled_device_count: 2.into(),
            });

        assert!(!recommendations.needs_sync_provider);
        assert!(!recommendations.needs_another_device);
        assert!(!recommendations.has_recommendations());
    }

    #[test]
    fn recommends_an_enrolled_device_when_the_roster_is_empty() {
        let recommendations =
            VaultSecurityRecommendations::assess_vault_security(VaultSecurityAssessment {
                sync_provider_count: 1.into(),
                enrolled_device_count: 0.into(),
            });

        assert!(!recommendations.needs_sync_provider);
        assert!(recommendations.needs_another_device);
    }
}
