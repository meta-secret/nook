//! Structured-clone passkey response schemas. Byte admission never coerces or wraps numbers.
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PasskeyByteMaterial(Vec<u8>);
impl PasskeyByteMaterial {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: WebAuthn structured-clone byte material uses octets"
        )
    )]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PasskeySetupMaterial {
    pub user_handle: PasskeyByteMaterial,
    pub prf_input: PasskeyByteMaterial,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PasskeyUnlockMaterial {
    pub credential_id: PasskeyByteMaterial,
    pub prf_input: PasskeyByteMaterial,
}
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
pub enum PasskeySetupAvailability {
    Available(PasskeySetupMaterial),
    #[default]
    Unavailable,
}
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
pub enum PasskeyUnlockAvailability {
    Available(PasskeyUnlockMaterial),
    #[default]
    Unavailable,
}
#[derive(Debug, Deserialize)]
pub struct PasskeySetupMaterialResponse {
    #[serde(default)]
    pub setup: PasskeySetupAvailability,
}
#[derive(Debug, Deserialize)]
pub struct PasskeyUnlockMaterialResponse {
    #[serde(default)]
    pub material: PasskeyUnlockAvailability,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn byte_material_rejects_lossy_conversions() -> anyhow::Result<()> {
        for input in ["[-1]", "[256]", "[1.5]", "[true]", "[\"1\"]"] {
            assert!(serde_json::from_str::<PasskeyByteMaterial>(input).is_err());
        }
        let material: PasskeyByteMaterial = serde_json::from_str("[0,255]")?;
        assert_eq!(material.as_bytes(), &[0, 255]);
        assert!(
            serde_json::from_str::<PasskeyByteMaterial>("[]")?
                .as_bytes()
                .is_empty()
        );
        Ok(())
    }
    #[test]
    fn setup_and_unlock_preserve_distinct_envelopes() -> anyhow::Result<()> {
        let setup: PasskeySetupMaterialResponse =
            serde_json::from_str(r#"{"setup":{"userHandle":[1],"prfInput":[2]}}"#)?;
        let PasskeySetupAvailability::Available(setup) = setup.setup else {
            anyhow::bail!("missing setup");
        };
        assert_eq!(setup.user_handle.as_bytes(), &[1]);
        assert!(matches!(
            serde_json::from_str::<PasskeyUnlockMaterialResponse>(
                r#"{"setup":{"userHandle":[1],"prfInput":[2]}}"#
            )?
            .material,
            PasskeyUnlockAvailability::Unavailable
        ));
        Ok(())
    }
}
