//! Typed request and response for one explicit personal-data form fill.

use nook_core::{PersonalFillValues, SecretId};
use nook_page_policy::{PersonalFieldGroup, PersonalFieldKind};
use tsify::Tsify;
use zeroize::Zeroize;

/// Generated structural input naming one record, its group, and the planned kinds.
#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NookPersonalFillRequest {
    #[tsify(type = "string")]
    pub secret_id: SecretId,
    #[tsify(type = "keyof typeof PersonalFieldGroup")]
    pub group: PersonalFieldGroup,
    #[tsify(type = "(keyof typeof PersonalFieldKind)[]")]
    pub kinds: Vec<PersonalFieldKind>,
}

/// One derived value for one planned field kind.
#[derive(serde::Serialize, Tsify)]
pub struct NookPersonalFillValue {
    #[tsify(type = "keyof typeof PersonalFieldKind")]
    pub kind: PersonalFieldKind,
    pub value: String,
}

/// Values for the requested kinds; kinds without a stored value are absent.
#[derive(serde::Serialize, Tsify)]
pub struct NookPersonalFillResponse {
    pub values: Vec<NookPersonalFillValue>,
}

impl From<&PersonalFillValues> for NookPersonalFillResponse {
    fn from(values: &PersonalFillValues) -> Self {
        Self {
            values: values
                .values()
                .iter()
                .map(|value| NookPersonalFillValue {
                    kind: value.kind(),
                    value: value.as_str().to_owned(),
                })
                .collect(),
        }
    }
}

impl Zeroize for NookPersonalFillResponse {
    fn zeroize(&mut self) {
        for value in &mut self.values {
            value.value.zeroize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NookPersonalFillRequest, NookPersonalFillResponse};
    use nook_core::SecretId;
    use nook_page_policy::{PersonalFieldGroup, PersonalFieldKind};
    use zeroize::Zeroize;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn request_uses_camel_case_generated_shape_and_rejects_unknown_values() -> anyhow::Result<()> {
        let request = NookPersonalFillRequest {
            secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
            group: PersonalFieldGroup::Address,
            kinds: vec![
                PersonalFieldKind::StreetAddress,
                PersonalFieldKind::PostalCode,
            ],
        };
        let encoded = serde_json::to_string(&request)?;
        assert_eq!(
            encoded,
            r#"{"secretId":"secret_SMypl8K0w9a","group":"Address","kinds":["StreetAddress","PostalCode"]}"#
        );
        let decoded: NookPersonalFillRequest = serde_json::from_str(&encoded)?;
        assert_eq!(decoded.secret_id, request.secret_id);
        assert_eq!(decoded.group, request.group);
        assert_eq!(decoded.kinds, request.kinds);
        for invalid in [
            r#"{"secretId":"secret_SMypl8K0w9a","group":"Passport","kinds":[]}"#,
            r#"{"secretId":"secret_SMypl8K0w9a","group":"Card","kinds":["Cvv"]}"#,
            r#"{"secretId":"secret_SMypl8K0w9a","group":"Card","kinds":[],"origin":"x"}"#,
            r#"{"secret_id":"secret_SMypl8K0w9a","group":"Card","kinds":[]}"#,
        ] {
            assert!(serde_json::from_str::<NookPersonalFillRequest>(invalid).is_err());
        }
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn response_zeroizes_every_value() -> anyhow::Result<()> {
        let mut response = NookPersonalFillResponse {
            values: vec![super::NookPersonalFillValue {
                kind: PersonalFieldKind::CardNumber,
                value: "4111111111111111".to_owned(),
            }],
        };
        assert_eq!(
            serde_json::to_string(&response)?,
            r#"{"values":[{"kind":"CardNumber","value":"4111111111111111"}]}"#
        );
        response.zeroize();
        assert!(response.values.iter().all(|value| value.value.is_empty()));
        Ok(())
    }
}
