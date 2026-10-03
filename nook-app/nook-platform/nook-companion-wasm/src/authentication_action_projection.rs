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
    request: Ts<AuthenticationBackupCodeExtractionRequest>,
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
    request: Ts<AuthenticationNavigationPathRequest>,
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
        assert!(extract_authentication_backup_code_candidates(backup.into_ts()?).is_ok());
        let navigation: AuthenticationNavigationPathRequest =
            serde_json::from_str(&serde_json::to_string(&NavigationActionFixture {
                pathname: "/account/login",
            })?)?;
        let actual = project_authentication_navigation_path(navigation.into_ts()?)?.to_rust()?;
        let expected: AuthenticationNavigationPathRequest =
            serde_json::from_str(&serde_json::to_string(&NavigationActionFixture {
                pathname: "/account/login",
            })?)?;
        assert_eq!(actual, expected.project());
        Ok(())
    }
}
