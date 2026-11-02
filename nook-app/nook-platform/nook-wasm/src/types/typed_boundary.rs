//! The one owner of the typed WASM boundary's two failures: a value from the
//! page that does not decode, and a value that does not encode for the page.

use serde::Serialize;
use serde::de::DeserializeOwned;
use tsify::{Ts, Tsify};

/// The fixed failures of the typed WASM boundary. Neither names the value,
/// which can hold a secret.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum TypedBoundaryError {
    #[error("Invalid typed WASM input.")]
    Input,
    #[error("Typed WASM output could not be encoded.")]
    Output,
}

/// A typed value from the page, decoded into its Rust type.
pub(crate) trait TypedInput<T> {
    fn decode(&self) -> Result<T, TypedBoundaryError>;
}

impl<T> TypedInput<T> for Ts<T>
where
    T: Tsify + DeserializeOwned,
    <T as Tsify>::JsType: Clone,
{
    fn decode(&self) -> Result<T, TypedBoundaryError> {
        self.to_rust().map_err(|_| TypedBoundaryError::Input)
    }
}

/// A Rust value encoded as the typed value the page receives.
pub(crate) trait TypedOutput: Tsify + Serialize + Sized {
    fn encode(&self) -> Result<Ts<Self>, TypedBoundaryError> {
        Ts::from_rust(self).map_err(|_| TypedBoundaryError::Output)
    }
}

impl<T: Tsify + Serialize> TypedOutput for T {}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use nook_core::ProviderKind;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn a_value_round_trips_through_the_boundary() -> anyhow::Result<()> {
        let encoded = ProviderKind::S3.encode()?;
        assert_eq!(encoded.decode()?, ProviderKind::S3);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn malformed_input_fails_with_the_fixed_text_only() -> Result<(), wasm_bindgen::JsError> {
        let secret = "TEST-ONLY-not-a-provider-kind";
        let malformed = Ts::<ProviderKind>::new_unchecked(serde_wasm_bindgen::to_value(secret)?);
        assert!(matches!(malformed.decode(), Err(TypedBoundaryError::Input)));
        let text = TypedBoundaryError::Input.to_string();
        assert_eq!(text, "Invalid typed WASM input.");
        assert!(!text.contains(secret));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn nook_error_keeps_the_boundary_text() {
        let error = crate::NookError::from(TypedBoundaryError::Output);
        assert_eq!(error.to_string(), "Typed WASM output could not be encoded.");
    }
}
