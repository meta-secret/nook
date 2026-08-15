//! Causal epoch validation for identity-held vault DEK grants.

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
            ) if (current_epoch == previous_key_epoch
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
                    IdentityVaultDekEpochUpdate::Observe { key_epoch, .. } => {
                        epoch_label(key_epoch)
                    }
                    IdentityVaultDekEpochUpdate::Rotate {
                        previous_key_epoch, ..
                    } => previous_key_epoch.to_string(),
                };
                return Err(MultiDeviceError::StaleVaultDekEpoch {
                    expected,
                    actual: epoch_label(current),
                });
            }
        };
        Ok(next)
    }
}

fn epoch_label(epoch: &IdentityVaultDekEpoch) -> String {
    match epoch {
        IdentityVaultDekEpoch::LegacyUnknown => "legacy-unknown".to_owned(),
        IdentityVaultDekEpoch::Known {
            key_epoch,
            checkpoint,
        } => format!("{key_epoch}@{checkpoint}"),
    }
}
