//! Causal epoch validation for identity-held vault DEK grants.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::identity::{IdentityVaultDek, IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate};
use crate::errors::{MultiDeviceError, MultiDeviceResult};

impl IdentityVaultDek {
    pub(super) fn next_epoch(
        &self,
        update: &IdentityVaultDekEpochUpdate,
    ) -> MultiDeviceResult<IdentityVaultDekEpoch> {
        let next = match (&self.key_epoch, update) {
            (
                IdentityVaultDekEpoch::LegacyUnknown,
                IdentityVaultDekEpochUpdate::Observe { key_epoch, .. },
            ) => key_epoch.clone(),
            (
                IdentityVaultDekEpoch::Known {
                    key_epoch: current_epoch,
                    checkpoint: current_checkpoint,
                },
                IdentityVaultDekEpochUpdate::Observe {
                    key_epoch:
                        IdentityVaultDekEpoch::Known {
                            key_epoch,
                            checkpoint,
                        },
                    checkpoint_ancestors,
                },
            ) if current_epoch == key_epoch
                && (current_checkpoint == checkpoint
                    || checkpoint_ancestors.contains(current_checkpoint)) =>
            {
                IdentityVaultDekEpoch::Known {
                    key_epoch: key_epoch.clone(),
                    checkpoint: checkpoint.clone(),
                }
            }
            (
                IdentityVaultDekEpoch::LegacyUnknown,
                IdentityVaultDekEpochUpdate::Rotate {
                    key_epoch,
                    checkpoint,
                    ..
                },
            ) => IdentityVaultDekEpoch::Known {
                key_epoch: key_epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
            (
                IdentityVaultDekEpoch::Known {
                    key_epoch: current_epoch,
                    checkpoint: current_checkpoint,
                },
                IdentityVaultDekEpochUpdate::Rotate {
                    previous_key_epoch,
                    previous_checkpoint_ancestors,
                    key_epoch,
                    checkpoint,
                },
            ) if ((current_epoch == previous_key_epoch
                || previous_checkpoint_ancestors.contains(current_epoch))
                && previous_checkpoint_ancestors.contains(current_checkpoint))
                || (current_epoch == key_epoch
                    && (current_checkpoint == checkpoint
                        || previous_checkpoint_ancestors.contains(current_checkpoint))) =>
            {
                IdentityVaultDekEpoch::Known {
                    key_epoch: key_epoch.clone(),
                    checkpoint: checkpoint.clone(),
                }
            }
            (current, update) => {
                let expected = match update {
                    IdentityVaultDekEpochUpdate::Observe { key_epoch, .. } => key_epoch.label(),
                    IdentityVaultDekEpochUpdate::Rotate {
                        previous_key_epoch, ..
                    } => previous_key_epoch.to_string(),
                };
                return Err(MultiDeviceError::StaleVaultDekEpoch {
                    expected,
                    actual: current.label(),
                });
            }
        };
        Ok(next)
    }
}

impl IdentityVaultDekEpoch {
    fn label(&self) -> String {
        match self {
            Self::LegacyUnknown => "legacy-unknown".to_owned(),
            Self::Known {
                key_epoch,
                checkpoint,
            } => format!("{key_epoch}@{checkpoint}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::IdentityVaultEventId;

    impl IdentityVaultEventId {
        fn fixture(fill: char) -> MultiDeviceResult<Self> {
            Ok(Self::parse(&format!(
                "sha256u:{}",
                fill.to_string().repeat(43)
            ))?)
        }
    }

    #[test]
    fn rotation_accepts_a_verified_descendant_chain_across_missed_epochs() -> MultiDeviceResult<()>
    {
        let original_epoch = IdentityVaultEventId::fixture('a')?;
        let original_checkpoint = IdentityVaultEventId::fixture('b')?;
        let intermediate_epoch = IdentityVaultEventId::fixture('c')?;
        let intermediate_checkpoint = IdentityVaultEventId::fixture('d')?;
        let current_epoch = IdentityVaultEventId::fixture('e')?;
        let current_checkpoint = IdentityVaultEventId::fixture('f')?;
        let grant = IdentityVaultDek {
            store_id: crate::StoreId::parse("store_abcdefghijk")?,
            key_epoch: IdentityVaultDekEpoch::Known {
                key_epoch: original_epoch.clone(),
                checkpoint: original_checkpoint.clone(),
            },
            secrets_envelopes: Vec::new(),
            members_envelopes: Vec::new(),
        };

        let next = grant.next_epoch(&IdentityVaultDekEpochUpdate::Rotate {
            previous_key_epoch: intermediate_epoch.clone(),
            previous_checkpoint_ancestors: vec![
                original_epoch,
                original_checkpoint,
                intermediate_epoch,
                intermediate_checkpoint,
            ],
            key_epoch: current_epoch.clone(),
            checkpoint: current_checkpoint.clone(),
        })?;

        assert_eq!(
            next,
            IdentityVaultDekEpoch::Known {
                key_epoch: current_epoch,
                checkpoint: current_checkpoint,
            }
        );
        Ok(())
    }

    #[test]
    fn observation_accepts_current_or_descendant_checkpoint_without_mutating_grant()
    -> anyhow::Result<()> {
        let epoch = IdentityVaultEventId::fixture('a')?;
        let checkpoint = IdentityVaultEventId::fixture('b')?;
        let advanced = IdentityVaultEventId::fixture('c')?;
        let grant = IdentityVaultDek {
            store_id: crate::StoreId::parse("store_abcdefghijk")?,
            key_epoch: IdentityVaultDekEpoch::Known {
                key_epoch: epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
            secrets_envelopes: Vec::new(),
            members_envelopes: Vec::new(),
        };
        let before = grant.clone();
        let same = IdentityVaultDekEpochUpdate::Observe {
            key_epoch: grant.key_epoch.clone(),
            checkpoint_ancestors: Vec::new(),
        };
        assert_eq!(grant.next_epoch(&same)?, grant.key_epoch);
        let next = IdentityVaultDekEpoch::Known {
            key_epoch: epoch,
            checkpoint: advanced,
        };
        let descendant = IdentityVaultDekEpochUpdate::Observe {
            key_epoch: next.clone(),
            checkpoint_ancestors: vec![checkpoint],
        };
        assert_eq!(grant.next_epoch(&descendant)?, next);
        assert_eq!(grant, before);
        Ok(())
    }

    #[test]
    fn stale_updates_preserve_exact_epoch_diagnostics_and_grant() -> anyhow::Result<()> {
        let epoch = IdentityVaultEventId::fixture('a')?;
        let checkpoint = IdentityVaultEventId::fixture('b')?;
        let other = IdentityVaultEventId::fixture('c')?;
        let grant = IdentityVaultDek {
            store_id: crate::StoreId::parse("store_abcdefghijk")?,
            key_epoch: IdentityVaultDekEpoch::Known {
                key_epoch: epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
            secrets_envelopes: Vec::new(),
            members_envelopes: Vec::new(),
        };
        let before = grant.clone();
        let actual_label = format!("{epoch}@{checkpoint}");
        for (update, expected_label) in [
            (
                IdentityVaultDekEpochUpdate::Observe {
                    key_epoch: IdentityVaultDekEpoch::Known {
                        key_epoch: epoch.clone(),
                        checkpoint: other.clone(),
                    },
                    checkpoint_ancestors: Vec::new(),
                },
                format!("{epoch}@{other}"),
            ),
            (
                IdentityVaultDekEpochUpdate::Observe {
                    key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                    checkpoint_ancestors: Vec::new(),
                },
                "legacy-unknown".to_owned(),
            ),
            (
                IdentityVaultDekEpochUpdate::Rotate {
                    previous_key_epoch: other.clone(),
                    previous_checkpoint_ancestors: Vec::new(),
                    key_epoch: other.clone(),
                    checkpoint: other.clone(),
                },
                other.to_string(),
            ),
        ] {
            match grant.next_epoch(&update) {
                Err(error @ MultiDeviceError::StaleVaultDekEpoch { .. }) => {
                    assert_eq!(
                        error.to_string(),
                        format!(
                            "Vault DEK epoch is stale: expected {expected_label}, found {actual_label}."
                        )
                    );
                    let MultiDeviceError::StaleVaultDekEpoch { expected, actual } = error else {
                        anyhow::bail!("expected stale epoch error");
                    };
                    assert_eq!(expected, expected_label);
                    assert_eq!(actual, actual_label);
                }
                _ => anyhow::bail!("expected stale epoch rejection"),
            }
            assert_eq!(grant, before);
        }
        Ok(())
    }
}
