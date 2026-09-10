//! Best-effort, non-authoritative metadata reported by a `WebAuthn` ceremony.

use js_sys::{Array, ArrayBuffer, Function, Uint8Array};
use nook_core::AuthenticatorGuidEvidence;
use nook_core::{
    PasskeyAuthenticatorAttachment, PasskeyBackupState, PasskeyObservedBrowser,
    PasskeyObservedPlatform, PasskeyTransport,
};
use wasm_bindgen::{JsCast, prelude::wasm_bindgen};
use web_sys::{
    AuthenticatorAssertionResponse, AuthenticatorAttestationResponse, PublicKeyCredential,
};

use crate::storage::device_access::PasskeyBrowserObservation;

pub(crate) struct BrowserPasskeyObservation<'a> {
    credential: &'a PublicKeyCredential,
}
impl<'a> BrowserPasskeyObservation<'a> {
    pub(crate) fn new(credential: &'a PublicKeyCredential) -> Self {
        Self { credential }
    }
}
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(extends = PublicKeyCredential, typescript_type = "PublicKeyCredential")]
    type ObservedPublicKeyCredential;

    #[wasm_bindgen(method, getter, structural, js_name = authenticatorAttachment)]
    fn authenticator_attachment(credential: &ObservedPublicKeyCredential) -> Option<String>;

    #[wasm_bindgen(
        extends = AuthenticatorAttestationResponse,
        typescript_type = "AuthenticatorAttestationResponse"
    )]
    type ObservedAuthenticatorAttestationResponse;

    #[wasm_bindgen(method, getter, structural, js_name = getTransports)]
    fn get_transports_method(
        response: &ObservedAuthenticatorAttestationResponse,
    ) -> Option<Function>;
}

impl BrowserPasskeyObservation<'_> {
    pub(crate) fn observe_registration(&self) -> PasskeyBrowserObservation {
        let credential = self.credential;
        let response: AuthenticatorAttestationResponse = credential.response().unchecked_into();
        let authenticator_data = response
            .get_authenticator_data()
            .ok()
            .and_then(|buffer| BrowserPasskeyObservation::authenticator_data(&buffer));
        PasskeyBrowserObservation {
            attachment: BrowserPasskeyObservation::new(credential).attachment(),
            transports: BrowserPasskeyObservation::registration_transports(&response),
            backup_state: authenticator_data
                .as_deref()
                .map_or(PasskeyBackupState::Unknown, Self::backup_state),
            aaguid: authenticator_data
                .as_deref()
                .map_or(AuthenticatorGuidEvidence::NotReported, Self::aaguid),
            ..client_environment()
        }
    }
}

impl BrowserPasskeyObservation<'_> {
    fn registration_transports(
        response: &AuthenticatorAttestationResponse,
    ) -> Vec<nook_core::PasskeyTransport> {
        let observed_response: &ObservedAuthenticatorAttestationResponse = response.unchecked_ref();
        let Some(method) = observed_response.get_transports_method() else {
            return Vec::new();
        };
        let Ok(value) = method.call0(response.as_ref()) else {
            return Vec::new();
        };
        let Ok(values) = value.dyn_into::<Array>() else {
            return Vec::new();
        };
        BrowserPasskeyObservation::transports(&values)
    }
}

impl BrowserPasskeyObservation<'_> {
    pub(crate) fn observe_assertion(&self) -> PasskeyBrowserObservation {
        let credential = self.credential;
        let response: AuthenticatorAssertionResponse = credential.response().unchecked_into();
        let authenticator_data =
            BrowserPasskeyObservation::authenticator_data(&response.authenticator_data());
        PasskeyBrowserObservation {
            attachment: BrowserPasskeyObservation::new(credential).attachment(),
            transports: Vec::new(),
            backup_state: authenticator_data
                .as_deref()
                .map_or(PasskeyBackupState::Unknown, Self::backup_state),
            aaguid: AuthenticatorGuidEvidence::NotReported,
            ..client_environment()
        }
    }
}

impl BrowserPasskeyObservation<'_> {
    fn attachment(&self) -> nook_core::PasskeyAuthenticatorAttachment {
        let credential = self.credential;
        let credential: &ObservedPublicKeyCredential = credential.unchecked_ref();
        match credential.authenticator_attachment().as_deref() {
            Some("platform") => PasskeyAuthenticatorAttachment::Platform,
            Some("cross-platform") => PasskeyAuthenticatorAttachment::CrossPlatform,
            _ => PasskeyAuthenticatorAttachment::Unknown,
        }
    }
}

impl BrowserPasskeyObservation<'_> {
    fn transports(array: &Array) -> Vec<nook_core::PasskeyTransport> {
        let mut values = Vec::new();
        for value in array.iter() {
            let Some(value) = value.as_string() else {
                continue;
            };
            let transport = match value.as_str() {
                "ble" => PasskeyTransport::Ble,
                "hybrid" => PasskeyTransport::Hybrid,
                "internal" => PasskeyTransport::Internal,
                "nfc" => PasskeyTransport::Nfc,
                "usb" => PasskeyTransport::Usb,
                _ => continue,
            };
            if !values.contains(&transport) {
                values.push(transport);
            }
        }
        values.sort();
        values
    }
}

impl BrowserPasskeyObservation<'_> {
    fn authenticator_data(buffer: &ArrayBuffer) -> Option<Vec<u8>> {
        let array = Uint8Array::new(buffer);
        (array.length() > 0).then(|| array.to_vec())
    }
}

impl BrowserPasskeyObservation<'_> {
    fn backup_state(data: &[u8]) -> nook_core::PasskeyBackupState {
        const FLAGS_INDEX: usize = 32;
        const BACKUP_ELIGIBLE: u8 = 0x08;
        const BACKUP_STATE: u8 = 0x10;
        let Some(flags) = data.get(FLAGS_INDEX).copied() else {
            return PasskeyBackupState::Unknown;
        };
        if flags & BACKUP_STATE != 0 {
            PasskeyBackupState::BackedUp
        } else if flags & BACKUP_ELIGIBLE != 0 {
            PasskeyBackupState::Eligible
        } else {
            PasskeyBackupState::NotEligible
        }
    }
}

impl BrowserPasskeyObservation<'_> {
    fn aaguid(data: &[u8]) -> AuthenticatorGuidEvidence {
        const FLAGS_INDEX: usize = 32;
        const ATTESTED_DATA: u8 = 0x40;
        const AAGUID_START: usize = 37;
        const AAGUID_END: usize = AAGUID_START + 16;
        if data.len() < AAGUID_END || data[FLAGS_INDEX] & ATTESTED_DATA == 0 {
            return AuthenticatorGuidEvidence::NotReported;
        }
        let bytes = &data[AAGUID_START..AAGUID_END];
        if bytes.iter().all(|byte| *byte == 0) {
            return AuthenticatorGuidEvidence::NotReported;
        }
        let hex = hex::encode(bytes);
        AuthenticatorGuidEvidence::Reported(format!(
            "{}-{}-{}-{}-{}",
            &hex[0..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..32]
        ))
    }
}

impl BrowserPasskeyObservation<'_> {
    fn client_environment() -> PasskeyBrowserObservation {
        let navigator = gloo_utils::window().navigator();
        let Ok(user_agent) = navigator.user_agent() else {
            return PasskeyBrowserObservation::default();
        };
        let browser = BrowserPasskeyObservation::observed_browser(&user_agent);
        let platform =
            BrowserPasskeyObservation::observed_platform(&user_agent, navigator.max_touch_points());
        PasskeyBrowserObservation {
            browser,
            platform,
            ..PasskeyBrowserObservation::default()
        }
    }
}

impl BrowserPasskeyObservation<'_> {
    fn observed_platform(
        user_agent: &str,
        max_touch_points: i32,
    ) -> nook_core::PasskeyObservedPlatform {
        if user_agent.contains("Android") {
            PasskeyObservedPlatform::Android
        } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
            PasskeyObservedPlatform::AppleMobile
        } else if user_agent.contains("Macintosh") && max_touch_points > 1 {
            // iPadOS desktop mode deliberately uses a Macintosh user agent. Touch
            // capability is the browser-supported discriminator recommended for
            // this otherwise indistinguishable case.
            PasskeyObservedPlatform::AppleMobile
        } else if user_agent.contains("Mac OS X") {
            PasskeyObservedPlatform::MacOs
        } else if user_agent.contains("Windows") {
            PasskeyObservedPlatform::Windows
        } else if user_agent.contains("Linux") {
            PasskeyObservedPlatform::Linux
        } else {
            PasskeyObservedPlatform::Other
        }
    }
}

impl BrowserPasskeyObservation<'_> {
    fn observed_browser(user_agent: &str) -> nook_core::PasskeyObservedBrowser {
        if user_agent.contains("OPR/") || user_agent.contains("SamsungBrowser/") {
            PasskeyObservedBrowser::Other
        } else if user_agent.contains("Edg/")
            || user_agent.contains("EdgA/")
            || user_agent.contains("EdgiOS/")
        {
            PasskeyObservedBrowser::Edge
        } else if user_agent.contains("Firefox/") || user_agent.contains("FxiOS/") {
            PasskeyObservedBrowser::Firefox
        } else if user_agent.contains("CriOS/") || user_agent.contains("Chrome/") {
            PasskeyObservedBrowser::Chrome
        } else if user_agent.contains("Safari/") {
            PasskeyObservedBrowser::Safari
        } else {
            PasskeyObservedBrowser::Other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn decodes_backup_flags_without_claiming_provider_identity() {
        let mut data = vec![0; 53];
        data[32] = 0x08;
        assert_eq!(
            BrowserPasskeyObservation::backup_state(&data),
            PasskeyBackupState::Eligible
        );
        data[32] = 0x18;
        assert_eq!(
            BrowserPasskeyObservation::backup_state(&data),
            PasskeyBackupState::BackedUp
        );
        data[32] = 0;
        assert_eq!(
            BrowserPasskeyObservation::backup_state(&data),
            PasskeyBackupState::NotEligible
        );
    }

    #[wasm_bindgen_test]
    fn formats_only_nonzero_attested_aaguid() {
        let mut data = vec![0; 53];
        data[32] = 0x40;
        assert_eq!(
            BrowserPasskeyObservation::aaguid(&data),
            AuthenticatorGuidEvidence::NotReported
        );
        data[37..53].copy_from_slice(&[1; 16]);
        assert_eq!(
            BrowserPasskeyObservation::aaguid(&data),
            AuthenticatorGuidEvidence::Reported("01010101-0101-0101-0101-010101010101".to_owned())
        );
    }

    #[wasm_bindgen_test]
    fn recognizes_ios_browser_tokens_before_safari_fallback() {
        assert_eq!(
            BrowserPasskeyObservation::observed_browser(
                "Mozilla/5.0 FxiOS/140.0 Mobile/15E148 Safari/605.1.15"
            ),
            PasskeyObservedBrowser::Firefox
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_browser(
                "Mozilla/5.0 EdgiOS/140.0 Mobile/15E148 Safari/605.1.15"
            ),
            PasskeyObservedBrowser::Edge
        );
    }

    #[wasm_bindgen_test]
    fn recognizes_edge_on_android_before_the_generic_chrome_token() {
        assert_eq!(
            BrowserPasskeyObservation::observed_browser(
                "Mozilla/5.0 (Linux; Android 15) Chrome/151.0.0.0 Mobile Safari/537.36 EdgA/151.0"
            ),
            PasskeyObservedBrowser::Edge
        );
    }

    #[wasm_bindgen_test]
    fn distinguishes_touch_capable_ipad_desktop_mode_from_macos() {
        let desktop_safari =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15";
        assert_eq!(
            BrowserPasskeyObservation::observed_platform(desktop_safari, 5),
            PasskeyObservedPlatform::AppleMobile
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_platform(desktop_safari, 0),
            PasskeyObservedPlatform::MacOs
        );
    }

    #[wasm_bindgen_test]
    fn recognizes_opera_before_the_generic_chrome_token() {
        assert_eq!(
            BrowserPasskeyObservation::observed_browser(
                "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 OPR/117.0.0.0"
            ),
            PasskeyObservedBrowser::Other
        );
    }

    #[wasm_bindgen_test]
    fn recognizes_samsung_internet_before_the_generic_chrome_token() {
        assert_eq!(
            BrowserPasskeyObservation::observed_browser(
                "Mozilla/5.0 (Linux; Android 15) Chrome/151.0 Mobile Safari/537.36 SamsungBrowser/29.0"
            ),
            PasskeyObservedBrowser::Other
        );
    }

    #[wasm_bindgen_test]
    fn transport_projection_deduplicates_sorts_and_ignores_unknown_values() {
        let values = Array::new();
        for value in ["usb", "ble", "usb", "internal", "nfc", "hybrid", "unknown"] {
            values.push(&value.into());
        }
        values.push(&42.into());
        assert_eq!(
            BrowserPasskeyObservation::transports(&values),
            vec![
                PasskeyTransport::Ble,
                PasskeyTransport::Hybrid,
                PasskeyTransport::Internal,
                PasskeyTransport::Nfc,
                PasskeyTransport::Usb,
            ]
        );
    }

    #[wasm_bindgen_test]
    fn authenticator_data_and_aaguid_fail_closed_for_short_or_unattested_data() {
        assert_eq!(
            BrowserPasskeyObservation::authenticator_data(&ArrayBuffer::new(0)),
            None
        );
        let buffer = ArrayBuffer::new(2);
        Uint8Array::new(&buffer).copy_from(&[1, 2]);
        assert_eq!(
            BrowserPasskeyObservation::authenticator_data(&buffer),
            Some(vec![1, 2])
        );

        assert_eq!(
            BrowserPasskeyObservation::backup_state(&[]),
            PasskeyBackupState::Unknown
        );
        assert_eq!(
            BrowserPasskeyObservation::aaguid(&[0; 10]),
            AuthenticatorGuidEvidence::NotReported
        );
        let mut not_attested = vec![0; 53];
        not_attested[32] = 0x08;
        assert_eq!(
            BrowserPasskeyObservation::aaguid(&not_attested),
            AuthenticatorGuidEvidence::NotReported
        );
    }

    #[wasm_bindgen_test]
    fn browser_and_platform_projection_covers_all_supported_tokens() {
        assert_eq!(
            BrowserPasskeyObservation::observed_browser("Mozilla/5.0 Safari/605.1.15"),
            PasskeyObservedBrowser::Safari
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_browser("Mozilla/5.0 Firefox/140.0"),
            PasskeyObservedBrowser::Firefox
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_browser("Mozilla/5.0 Chrome/140.0"),
            PasskeyObservedBrowser::Chrome
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_browser("Mozilla/5.0 Edg/140.0"),
            PasskeyObservedBrowser::Edge
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_browser("Mozilla/5.0 unknown"),
            PasskeyObservedBrowser::Other
        );

        assert_eq!(
            BrowserPasskeyObservation::observed_platform("Mozilla/5.0 (Linux; Android 15)", 0),
            PasskeyObservedPlatform::Android
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_platform(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
                0
            ),
            PasskeyObservedPlatform::AppleMobile
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_platform(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                0
            ),
            PasskeyObservedPlatform::Windows
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_platform("Mozilla/5.0 (X11; Linux x86_64)", 0),
            PasskeyObservedPlatform::Linux
        );
        assert_eq!(
            BrowserPasskeyObservation::observed_platform("Mozilla/5.0 (X11; Plan9)", 0),
            PasskeyObservedPlatform::Other
        );
    }
}
