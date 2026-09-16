use nook_core::StoreId;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

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
    pub(crate) fn from_raw(value: &str) -> Result<Self, JsError> {
        if value.trim().is_empty() {
            return Ok(Self(None));
        }
        StoreId::parse(value)
            .map(|store_id| Self(Some(store_id)))
            .map_err(|error| JsError::new(&error.to_string()))
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
        self.0
            .clone()
            .map(NookStoreId::from)
            .ok_or_else(|| JsError::new("vault store identity is absent"))
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
    fn generated_store_id_has_an_explicit_string_edge() -> Result<(), JsError> {
        let presence = NookStoreIdPresence::from_raw(StoreIdValueScenario::valid())?;
        assert_eq!(presence.state(), NookStoreIdPresenceState::Present);
        assert_eq!(presence.store_id()?.value(), StoreIdValueScenario::valid());
        Ok(())
    }

    #[test]
    fn absent_store_id_cannot_be_unwrapped_as_an_empty_string() -> Result<(), JsError> {
        let presence = NookStoreIdPresence::from_raw("")?;
        assert_eq!(presence.state(), NookStoreIdPresenceState::Absent);
        assert!(presence.store_id().is_err());
        Ok(())
    }
}
