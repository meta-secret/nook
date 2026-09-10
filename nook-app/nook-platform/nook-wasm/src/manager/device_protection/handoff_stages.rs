//! Single-use handles gate browser sequencing; live generation checks revoke stale handles.
//! Handles own only a public recipient and allocation identity, never plaintext secrets.
//! Dropping a handle cannot retain manager keys; manager lock/reset/drop retain their
//! existing zeroization responsibilities. Explicit transport cancellation remains an effect.
use super::{NookExtensionIdentityHandoffContext, NookVaultManager};
use crate::manager::device_protection::ExtensionIdentityPublication;
use std::rc::Rc;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

pub(in crate::manager) struct HandoffBinding {
    generation: Rc<()>,
}
impl HandoffBinding {
    pub(in crate::manager) fn new(manager: &NookVaultManager) -> Self {
        Self {
            generation: manager.device.handoff_generation.clone(),
        }
    }
    pub(in crate::manager) fn check(&self, manager: &NookVaultManager) -> Result<(), JsError> {
        if Rc::ptr_eq(&self.generation, &manager.device.handoff_generation) {
            Ok(())
        } else {
            Err(JsError::new(
                "Extension identity handoff is no longer current.",
            ))
        }
    }
}

/// The phase cannot be fabricated, cloned, defaulted, or deserialized.
///
/// ```compile_fail,E0599
/// use nook_wasm::NookPendingExtensionIdentityHandoff;
/// let duplicate = |phase: NookPendingExtensionIdentityHandoff| phase.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_wasm::NookPendingExtensionIdentityHandoff;
/// let decode = |json: &str| serde_json::from_str::<NookPendingExtensionIdentityHandoff>(json);
/// ```
///
/// ```compile_fail,E0599
/// use nook_wasm::NookPendingExtensionIdentityHandoff;
/// let phase = NookPendingExtensionIdentityHandoff::default();
/// ```
///
/// ```compile_fail,E0599
/// use nook_wasm::{NookPendingExtensionIdentityHandoff, NookVaultManager};
/// let premature = |pending: NookPendingExtensionIdentityHandoff, manager: &mut NookVaultManager| {
///     pending.commit(manager)
/// };
/// ```
#[wasm_bindgen]
pub struct NookPendingExtensionIdentityHandoff {
    binding: HandoffBinding,
    recipient_public_key: String,
}
impl NookPendingExtensionIdentityHandoff {
    pub(super) fn new(manager: &NookVaultManager, recipient_public_key: String) -> Self {
        Self {
            binding: HandoffBinding::new(manager),
            recipient_public_key,
        }
    }
}
#[wasm_bindgen]
impl NookPendingExtensionIdentityHandoff {
    #[wasm_bindgen(getter)]
    pub fn recipient_public_key(&self) -> String {
        self.recipient_public_key.clone()
    }
    #[expect(
        clippy::too_many_arguments,
        reason = "wasm-bindgen owns this exported handoff boundary signature"
    )]
    pub async fn finish(
        self,
        manager: &mut NookVaultManager,
        envelope: &str,
        nonce: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        context: &NookExtensionIdentityHandoffContext,
    ) -> Result<NookAdoptedExtensionIdentityHandoff, JsError> {
        self.binding.check(manager)?;
        if let Err(error) = manager
            .finish_extension_identity_handoff(
                envelope,
                nonce,
                expected_device_id,
                expected_device_public_key,
                expected_device_signing_public_key,
                context,
            )
            .await
        {
            manager.rollback_extension_identity_handoff();
            return Err(error);
        }
        Ok(NookAdoptedExtensionIdentityHandoff {
            binding: self.binding,
        })
    }
    pub fn cancel(self, manager: &mut NookVaultManager) -> Result<(), JsError> {
        self.binding.check(manager)?;
        manager.rollback_extension_identity_handoff();
        Ok(())
    }
}

/// The phase cannot be fabricated, cloned, defaulted, or deserialized.
///
/// ```compile_fail,E0599
/// use nook_wasm::NookAdoptedExtensionIdentityHandoff;
/// let duplicate = |phase: NookAdoptedExtensionIdentityHandoff| phase.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_wasm::NookAdoptedExtensionIdentityHandoff;
/// let decode = |json: &str| serde_json::from_str::<NookAdoptedExtensionIdentityHandoff>(json);
/// ```
///
/// ```compile_fail,E0599
/// use nook_wasm::NookAdoptedExtensionIdentityHandoff;
/// let phase = NookAdoptedExtensionIdentityHandoff::default();
/// ```
#[wasm_bindgen]
pub struct NookAdoptedExtensionIdentityHandoff {
    binding: HandoffBinding,
}
impl NookAdoptedExtensionIdentityHandoff {
    pub(in crate::manager) fn new(manager: &NookVaultManager) -> Self {
        Self {
            binding: HandoffBinding::new(manager),
        }
    }
}
#[wasm_bindgen]
impl NookAdoptedExtensionIdentityHandoff {
    pub fn requires_connect(&self, manager: &NookVaultManager) -> Result<bool, JsError> {
        self.binding.check(manager)?;
        Ok(manager.extension_identity_handoff_requires_connect())
    }
    pub fn mark_existing_vault_import(
        &self,
        manager: &mut NookVaultManager,
    ) -> Result<(), JsError> {
        self.binding.check(manager)?;
        manager.mark_extension_identity_handoff_existing_vault_import()
    }
    pub async fn commit(
        self,
        manager: &mut NookVaultManager,
    ) -> Result<NookCommittedExtensionIdentityHandoff, JsError> {
        self.binding.check(manager)?;
        if let Err(error) = manager.commit_extension_identity_handoff().await {
            manager.rollback_extension_identity_handoff();
            return Err(error);
        }
        Ok(NookCommittedExtensionIdentityHandoff {
            binding: self.binding,
        })
    }
    /// Verified connect owns publication and clears the pending record.
    pub fn after_verified_connect(
        self,
        manager: &mut NookVaultManager,
    ) -> Result<NookCommittedExtensionIdentityHandoff, JsError> {
        self.binding.check(manager)?;
        if matches!(
            &manager.device.pending_extension_handoff,
            ExtensionIdentityPublication::Staged(_)
        ) {
            manager.rollback_extension_identity_handoff();
            return Err(JsError::new(
                "Extension identity handoff has not completed verified connect.",
            ));
        }
        Ok(NookCommittedExtensionIdentityHandoff {
            binding: self.binding,
        })
    }
    pub fn rollback(self, manager: &mut NookVaultManager) -> Result<(), JsError> {
        self.binding.check(manager)?;
        manager.rollback_extension_identity_handoff();
        Ok(())
    }
}

/// The phase cannot be fabricated, cloned, defaulted, or deserialized.
///
/// ```compile_fail,E0599
/// use nook_wasm::NookCommittedExtensionIdentityHandoff;
/// let duplicate = |phase: NookCommittedExtensionIdentityHandoff| phase.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_wasm::NookCommittedExtensionIdentityHandoff;
/// let decode = |json: &str| serde_json::from_str::<NookCommittedExtensionIdentityHandoff>(json);
/// ```
///
/// ```compile_fail,E0599
/// use nook_wasm::NookCommittedExtensionIdentityHandoff;
/// let phase = NookCommittedExtensionIdentityHandoff::default();
/// ```
///
/// ```compile_fail,E0382
/// use nook_wasm::{NookCommittedExtensionIdentityHandoff, NookVaultManager};
/// let repeat = |committed: NookCommittedExtensionIdentityHandoff, manager: &mut NookVaultManager| {
///     committed.confirm(manager);
///     committed.confirm(manager)
/// };
/// ```
#[wasm_bindgen]
pub struct NookCommittedExtensionIdentityHandoff {
    binding: HandoffBinding,
}
#[wasm_bindgen]
impl NookCommittedExtensionIdentityHandoff {
    pub fn confirm(self, manager: &mut NookVaultManager) -> Result<(), JsError> {
        self.binding.check(manager)?;
        manager.confirm_extension_identity_handoff();
        manager.device.handoff_generation = Rc::default();
        Ok(())
    }
    pub fn rollback(self, manager: &mut NookVaultManager) -> Result<(), JsError> {
        self.binding.check(manager)?;
        manager.rollback_extension_identity_handoff();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn lock_new_ceremony_and_foreign_manager_revoke_pending_handles() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        let pending = manager.begin_extension_identity_handoff()?;
        assert!(pending.binding.check(&NookVaultManager::new()).is_err());
        manager.lock_device_identity();
        assert!(pending.binding.check(&manager).is_err());
        let first = manager.begin_extension_identity_handoff()?;
        let second = manager.begin_extension_identity_handoff()?;
        assert!(first.binding.check(&manager).is_err());
        assert!(second.binding.check(&manager).is_ok());
        second.cancel(&mut manager)?;
        assert!(manager.device.extension_handoff_private_key.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn confirmation_revokes_the_completed_generation() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        let binding = HandoffBinding::new(&manager);
        let adopted = NookAdoptedExtensionIdentityHandoff::new(&manager);
        adopted
            .after_verified_connect(&mut manager)?
            .confirm(&mut manager)?;
        assert!(binding.check(&manager).is_err());
        Ok(())
    }
}
