//! Typed export of the Rust-owned browser tab target classifier.
use nook_companion_core::{BrowserTabTarget, BrowserTabUrlObservation};
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_browser_tab_target(
    observation: &Ts<BrowserTabUrlObservation>,
) -> Result<Ts<BrowserTabTarget>, JsError> {
    let observation = observation
        .to_rust()
        .map_err(|_| JsError::new("Invalid browser tab observation."))?;
    observation
        .classify()
        .into_ts()
        .map_err(|_| JsError::new("Browser tab target could not be encoded."))
}

#[cfg(test)]
mod tests {
    use nook_companion_core::{
        BrowserTabTarget, BrowserTabUrl, BrowserTabUrlObservation, WebTabDisplayHost, WebTabOrigin,
        WebTabTarget,
    };
    use tsify::Tsify;

    #[test]
    fn tab_target_bridge_declares_the_tagged_observation_and_target_unions() {
        assert!(BrowserTabUrlObservation::DECL.contains(r#"kind: "Unavailable""#));
        assert!(BrowserTabUrlObservation::DECL.contains(r#"kind: "Observed"; url: BrowserTabUrl"#));
        assert!(BrowserTabUrl::DECL.contains("BrowserTabUrl = string"));
        assert!(BrowserTabTarget::DECL.contains(r#"kind: "Web""#));
        assert!(BrowserTabTarget::DECL.contains("WebTabTarget"));
        assert!(BrowserTabTarget::DECL.contains(r#"kind: "NonWeb""#));
        assert!(BrowserTabTarget::DECL.contains(r#"kind: "NookVaultApp""#));
        assert!(WebTabTarget::DECL.contains("origin: WebTabOrigin"));
        assert!(WebTabTarget::DECL.contains("display_host: WebTabDisplayHost"));
        assert!(WebTabOrigin::DECL.contains("WebTabOrigin = string"));
        assert!(WebTabDisplayHost::DECL.contains("WebTabDisplayHost = string"));
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use nook_companion_core::BrowserTabUrl;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct TabKindCase {
        observation: BrowserTabUrlObservation,
        kind: &'static str,
    }

    #[wasm_bindgen_test]
    fn tab_target_export_returns_the_core_classification_as_a_structural_value()
    -> Result<(), JsError> {
        let observed = BrowserTabUrlObservation::Observed {
            url: BrowserTabUrl::from(
                "https://alice:secret@www.example.com:8443/login?x=1".to_owned(),
            ),
        };
        let target = classify_browser_tab_target(&observed.into_ts()?)?;
        let actual: serde_json::Value = serde_wasm_bindgen::from_value(target.js_value())?;
        assert_eq!(
            actual,
            serde_json::json!({
                "kind": "Web",
                "origin": "https://www.example.com:8443",
                "display_host": "www.example.com",
            })
        );
        for case in [
            TabKindCase {
                observation: BrowserTabUrlObservation::Unavailable {},
                kind: "NonWeb",
            },
            TabKindCase {
                observation: BrowserTabUrlObservation::Observed {
                    url: BrowserTabUrl::from("chrome://settings".to_owned()),
                },
                kind: "NonWeb",
            },
            TabKindCase {
                observation: BrowserTabUrlObservation::Observed {
                    url: BrowserTabUrl::from("https://simple.nokey.sh/".to_owned()),
                },
                kind: "NookVaultApp",
            },
        ] {
            let target = classify_browser_tab_target(&case.observation.into_ts()?)?;
            let actual: serde_json::Value = serde_wasm_bindgen::from_value(target.js_value())?;
            assert_eq!(actual, serde_json::json!({ "kind": case.kind }));
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn tab_target_export_rejects_malformed_observations() -> Result<(), JsError> {
        for value in [
            serde_json::json!("https://example.com"),
            serde_json::json!({ "kind": "Observed" }),
            serde_json::json!({ "kind": "Observed", "url": "https://example.com", "tab_id": 4 }),
            serde_json::json!({ "kind": "Unavailable", "url": "https://example.com" }),
        ] {
            let observation = Ts::new_unchecked(serde_wasm_bindgen::to_value(&value)?);
            assert!(classify_browser_tab_target(&observation).is_err());
        }
        Ok(())
    }
}
