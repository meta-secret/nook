//! JavaScript projections for an identity-directory snapshot.

use super::{
    NookIdentityDirectorySelection, NookIdentityDirectorySelectionKind,
    NookIdentityDirectorySnapshot, NookIdentitySnapshot, NookSelectedVaultIdentityContextKind,
    current_browser_identity, selected_vault_context_kind,
};
use crate::device_access::NookDeviceAccessSnapshot;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookIdentityDirectorySnapshot {
    #[wasm_bindgen(getter)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `length` count through a JavaScript Number scalar"
        )
    )]
    pub fn length(&self) -> usize {
        self.identities.len()
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: accepts the identity-array index as a JavaScript Number scalar"
        )
    )]
    pub fn identity(&self, index: usize) -> Result<NookIdentitySnapshot, wasm_bindgen::JsError> {
        self.identities
            .get(index)
            .cloned()
            .ok_or_else(|| JsError::new("Identity index is out of bounds"))
    }

    #[wasm_bindgen(getter, js_name = selectedVaultContextKind)]
    pub fn selected_vault_context_kind(&self) -> NookSelectedVaultIdentityContextKind {
        selected_vault_context_kind(&self.identities, self.selected_vault_current_app_granted)
    }

    pub fn current_browser_identity(&self) -> Result<NookIdentitySnapshot, wasm_bindgen::JsError> {
        if self.selected_vault_context_kind()
            != NookSelectedVaultIdentityContextKind::LinkedWithCurrent
        {
            return Err(JsError::new(
                "No linked identity grants this browser access to the selected vault",
            ));
        }
        current_browser_identity(&self.identities)
            .cloned()
            .ok_or_else(|| JsError::new("No linked identity belongs to this browser"))
    }

    /// Return access evidence captured from the same protected app ID as the
    /// directory selection and current-browser ownership flags.
    pub fn device_access(&self) -> NookDeviceAccessSnapshot {
        self.access.clone()
    }

    #[wasm_bindgen(getter, js_name = selectionKind)]
    pub fn selection_kind(&self) -> NookIdentityDirectorySelectionKind {
        match self.selection {
            NookIdentityDirectorySelection::Empty => NookIdentityDirectorySelectionKind::Empty,
            NookIdentityDirectorySelection::Selected(_) => {
                NookIdentityDirectorySelectionKind::Selected
            }
        }
    }

    #[wasm_bindgen(getter, js_name = selectedIdentityId)]
    pub fn selected_identity_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.selection {
            NookIdentityDirectorySelection::Empty => {
                Err(JsError::new("Identity directory has no selection"))
            }
            NookIdentityDirectorySelection::Selected(identity_id) => Ok(identity_id.clone()),
        }
    }
}
