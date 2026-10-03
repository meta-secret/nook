//! Typed action projections executed in the extension-owned WASM runtime.
use nook_companion_core::{
    AuthenticationBackupCodeExtraction, AuthenticationBackupCodeExtractionRequest,
    AuthenticationNavigationPathProjection, AuthenticationNavigationPathRequest,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn extract_authentication_backup_code_candidates(
    request: &Ts<AuthenticationBackupCodeExtractionRequest>,
) -> Result<Ts<AuthenticationBackupCodeExtraction>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Invalid bounded backup-code extraction request."))?;
    request
        .extract()
        .into_ts()
        .map_err(|_| JsError::new("Backup-code projection could not be encoded."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn project_authentication_navigation_path(
    request: &Ts<AuthenticationNavigationPathRequest>,
) -> Result<Ts<AuthenticationNavigationPathProjection>, JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Invalid bounded pathname request."))?;
    request
        .project()
        .into_ts()
        .map_err(|_| JsError::new("Navigation projection could not be encoded."))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_projection_bridge_declares_structural_metadata_and_named_observation() {
        assert!(
            AuthenticationBackupCodeExtractionRequest::DECL
                .contains("text: AuthenticationBackupCodeText")
        );
        assert!(AuthenticationBackupCodeExtraction::DECL.contains("codes: string[]"));
        assert!(
            AuthenticationNavigationPathRequest::DECL
                .contains("pathname: AuthenticationOutcomePathname")
        );
        assert!(
            AuthenticationNavigationPathProjection::DECL
                .contains("observation: AuthenticationNavigationPathObservation")
        );
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use serde::Serialize;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[derive(Serialize)]
    struct BackupActionFixture<'a> {
        text: &'a str,
    }
    #[derive(Serialize)]
    struct NavigationActionFixture<'a> {
        pathname: &'a str,
    }
    #[wasm_bindgen_test]
    fn action_projection_typed_bridge_preserves_existing_action_domain_results()
    -> Result<(), JsError> {
        let backup: AuthenticationBackupCodeExtractionRequest =
            serde_json::from_str(&serde_json::to_string(&BackupActionFixture {
                text: "A1B2-C3D4-E5F6",
            })?)?;
        let actual = extract_authentication_backup_code_candidates(&backup.into_ts()?)?;
        let serialized: serde_json::Value = serde_wasm_bindgen::from_value(actual.js_value())?;
        assert_eq!(serialized["codes"], serde_json::json!(["A1B2-C3D4-E5F6"]));
        let navigation: AuthenticationNavigationPathRequest =
            serde_json::from_str(&serde_json::to_string(&NavigationActionFixture {
                pathname: "/account/login",
            })?)?;
        let actual = project_authentication_navigation_path(&navigation.into_ts()?)?.to_rust()?;
        let expected: AuthenticationNavigationPathRequest =
            serde_json::from_str(&serde_json::to_string(&NavigationActionFixture {
                pathname: "/account/login",
            })?)?;
        assert_eq!(actual, expected.project());
        Ok(())
    }
    #[wasm_bindgen_test]
    fn action_projection_typed_bridge_rejects_invalid_and_overbound_js_inputs()
    -> Result<(), JsError> {
        for text in [
            serde_json::Value::Bool(false),
            serde_json::Value::String("é".repeat(32_769)),
        ] {
            let value = serde_wasm_bindgen::to_value(&serde_json::json!({"text": text}))?;
            assert!(
                extract_authentication_backup_code_candidates(&Ts::new_unchecked(value)).is_err()
            );
        }
        for pathname in ["/login?secret=value".to_owned(), "/".repeat(4097)] {
            let value = serde_wasm_bindgen::to_value(&NavigationActionFixture {
                pathname: &pathname,
            })?;
            assert!(project_authentication_navigation_path(&Ts::new_unchecked(value)).is_err());
        }
        let request: AuthenticationNavigationPathRequest =
            serde_json::from_str(r#"{"pathname":"/ordinary"}"#)?;
        let result = project_authentication_navigation_path(&request.into_ts()?)?;
        let actual: serde_json::Value = serde_wasm_bindgen::from_value(result.js_value())?;
        assert_eq!(actual, serde_json::json!({"observation":"Unrelated"}));
        Ok(())
    }
}
