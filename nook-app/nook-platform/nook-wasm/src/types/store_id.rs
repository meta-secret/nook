use nook_core::StoreId;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum StoreIdPresenceError {
    #[error("vault store identity is absent")]
    Absent,
    #[error(transparent)]
    Invalid(#[from] nook_core::ValidationError),
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct NookStoreId(StoreId);

impl From<StoreId> for NookStoreId {
    fn from(value: StoreId) -> Self {
        Self(value)
    }
}

impl NookStoreId {
    pub(crate) fn as_core(&self) -> &StoreId {
        &self.0
    }
}

#[wasm_bindgen]
impl NookStoreId {
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> String {
        self.0.as_str().to_owned()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookStoreIdPresenceState {
    Absent,
    Present,
}

#[wasm_bindgen]
pub struct NookStoreIdPresence(Option<StoreId>);

impl NookStoreIdPresence {
    pub(crate) fn from_raw(value: &str) -> Result<Self, StoreIdPresenceError> {
        if value.trim().is_empty() {
            return Ok(Self(None));
        }
        StoreId::parse(value)
            .map(|store_id| Self(Some(store_id)))
            .map_err(StoreIdPresenceError::Invalid)
    }

    fn require_store_id(&self) -> Result<StoreId, StoreIdPresenceError> {
        self.0.clone().ok_or(StoreIdPresenceError::Absent)
    }
}

#[wasm_bindgen]
impl NookStoreIdPresence {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookStoreIdPresenceState {
        match self.0 {
            Some(_) => NookStoreIdPresenceState::Present,
            None => NookStoreIdPresenceState::Absent,
        }
    }

    pub fn store_id(&self) -> Result<NookStoreId, JsError> {
        self.require_store_id()
            .map(NookStoreId::from)
            .map_err(|error| JsError::new(&error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StoreIdValueScenario;

    impl StoreIdValueScenario {
        fn valid() -> &'static str {
            "store_abcdefghijk"
        }
    }

    #[test]
    fn generated_store_id_has_an_explicit_string_edge() -> Result<(), StoreIdPresenceError> {
        let presence = NookStoreIdPresence::from_raw(StoreIdValueScenario::valid())?;
        assert_eq!(presence.state(), NookStoreIdPresenceState::Present);
        assert_eq!(
            presence.require_store_id()?.as_str(),
            StoreIdValueScenario::valid()
        );
        Ok(())
    }

    #[test]
    fn absent_store_id_returns_a_typed_error_without_constructing_a_js_error()
    -> Result<(), StoreIdPresenceError> {
        let presence = NookStoreIdPresence::from_raw("")?;
        assert_eq!(presence.state(), NookStoreIdPresenceState::Absent);
        assert!(matches!(
            presence.require_store_id(),
            Err(StoreIdPresenceError::Absent)
        ));
        Ok(())
    }

    #[test]
    fn malformed_store_id_preserves_core_validation() {
        assert!(matches!(
            NookStoreIdPresence::from_raw("invalid"),
            Err(StoreIdPresenceError::Invalid(
                nook_core::ValidationError::StoreIdInvalid
            ))
        ));
    }
}
