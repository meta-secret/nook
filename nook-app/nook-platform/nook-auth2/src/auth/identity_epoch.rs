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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::IdentityVaultEventId;

    fn event_id(fill: char) -> MultiDeviceResult<IdentityVaultEventId> {
        Ok(IdentityVaultEventId::parse(&format!(
            "sha256u:{}",
            fill.to_string().repeat(43)
        ))?)
    }

    #[test]
    fn rotation_accepts_a_verified_descendant_chain_across_missed_epochs() -> MultiDeviceResult<()>
    {
        let original_epoch = event_id('a')?;
        let original_checkpoint = event_id('b')?;
        let intermediate_epoch = event_id('c')?;
        let intermediate_checkpoint = event_id('d')?;
        let current_epoch = event_id('e')?;
        let current_checkpoint = event_id('f')?;
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
}
