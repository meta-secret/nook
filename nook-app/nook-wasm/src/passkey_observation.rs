//! Best-effort, non-authoritative metadata reported by a `WebAuthn` ceremony.

use js_sys::{Array, ArrayBuffer, Function, Uint8Array};
use wasm_bindgen::{JsCast, prelude::wasm_bindgen};
use web_sys::{
    AuthenticatorAssertionResponse, AuthenticatorAttestationResponse, PublicKeyCredential,
};

use crate::storage::device_access::PasskeyBrowserObservation;

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

pub(crate) fn observe_registration(credential: &PublicKeyCredential) -> PasskeyBrowserObservation {
    let response: AuthenticatorAttestationResponse = credential.response().unchecked_into();
    let authenticator_data = response
        .get_authenticator_data()
        .ok()
        .and_then(|buffer| authenticator_data(&buffer));
    PasskeyBrowserObservation {
        attachment: attachment(credential),
        transports: registration_transports(&response),
        backup_state: authenticator_data
            .as_deref()
            .map_or(nook_core::PasskeyBackupState::Unknown, backup_state),
        aaguid: authenticator_data.as_deref().and_then(aaguid),
        ..client_environment()
    }
}

fn registration_transports(response: &AuthenticatorAttestationResponse) -> Vec<String> {
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
    transports(&values)
}

pub(crate) fn observe_assertion(credential: &PublicKeyCredential) -> PasskeyBrowserObservation {
    let response: AuthenticatorAssertionResponse = credential.response().unchecked_into();
    let authenticator_data = authenticator_data(&response.authenticator_data());
    PasskeyBrowserObservation {
        attachment: attachment(credential),
        transports: Vec::new(),
        backup_state: authenticator_data
            .as_deref()
            .map_or(nook_core::PasskeyBackupState::Unknown, backup_state),
        aaguid: None,
        ..client_environment()
    }
}

fn attachment(credential: &PublicKeyCredential) -> nook_core::PasskeyAuthenticatorAttachment {
    let credential: &ObservedPublicKeyCredential = credential.unchecked_ref();
    match credential.authenticator_attachment().as_deref() {
        Some("platform") => nook_core::PasskeyAuthenticatorAttachment::Platform,
        Some("cross-platform") => nook_core::PasskeyAuthenticatorAttachment::CrossPlatform,
        _ => nook_core::PasskeyAuthenticatorAttachment::Unknown,
    }
}

fn transports(array: &Array) -> Vec<String> {
    let mut values = Vec::new();
    for value in array.iter() {
        let Some(value) = value.as_string() else {
            continue;
        };
        if matches!(
            value.as_str(),
            "internal" | "hybrid" | "usb" | "nfc" | "ble"
        ) && !values.contains(&value)
        {
            values.push(value);
        }
    }
    values.sort();
    values
}

fn authenticator_data(buffer: &ArrayBuffer) -> Option<Vec<u8>> {
    let array = Uint8Array::new(buffer);
    (array.length() > 0).then(|| array.to_vec())
}

fn backup_state(data: &[u8]) -> nook_core::PasskeyBackupState {
    const FLAGS_INDEX: usize = 32;
    const BACKUP_ELIGIBLE: u8 = 0x08;
    const BACKUP_STATE: u8 = 0x10;
    let Some(flags) = data.get(FLAGS_INDEX).copied() else {
        return nook_core::PasskeyBackupState::Unknown;
    };
    if flags & BACKUP_STATE != 0 {
        nook_core::PasskeyBackupState::BackedUp
    } else if flags & BACKUP_ELIGIBLE != 0 {
        nook_core::PasskeyBackupState::Eligible
    } else {
        nook_core::PasskeyBackupState::NotEligible
    }
}

fn aaguid(data: &[u8]) -> Option<String> {
    const FLAGS_INDEX: usize = 32;
    const ATTESTED_DATA: u8 = 0x40;
    const AAGUID_START: usize = 37;
    const AAGUID_END: usize = AAGUID_START + 16;
    if data.get(FLAGS_INDEX).copied()? & ATTESTED_DATA == 0 || data.len() < AAGUID_END {
        return None;
    }
    let bytes = &data[AAGUID_START..AAGUID_END];
    if bytes.iter().all(|byte| *byte == 0) {
        return None;
    }
    let hex = hex::encode(bytes);
    Some(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

fn client_environment() -> PasskeyBrowserObservation {
    let navigator = gloo_utils::window().navigator();
    let Ok(user_agent) = navigator.user_agent() else {
        return PasskeyBrowserObservation::default();
    };
    let browser = observed_browser(&user_agent);
    let platform = observed_platform(&user_agent, navigator.max_touch_points());
    PasskeyBrowserObservation {
        browser,
        platform,
        ..PasskeyBrowserObservation::default()
    }
}

fn observed_platform(
    user_agent: &str,
    max_touch_points: i32,
) -> nook_core::PasskeyObservedPlatform {
    if user_agent.contains("Android") {
        nook_core::PasskeyObservedPlatform::Android
    } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
        nook_core::PasskeyObservedPlatform::AppleMobile
    } else if user_agent.contains("Macintosh") && max_touch_points > 1 {
        // iPadOS desktop mode deliberately uses a Macintosh user agent. Touch
        // capability is the browser-supported discriminator recommended for
        // this otherwise indistinguishable case.
        nook_core::PasskeyObservedPlatform::AppleMobile
    } else if user_agent.contains("Mac OS X") {
        nook_core::PasskeyObservedPlatform::MacOs
    } else if user_agent.contains("Windows") {
        nook_core::PasskeyObservedPlatform::Windows
    } else if user_agent.contains("Linux") {
        nook_core::PasskeyObservedPlatform::Linux
    } else {
        nook_core::PasskeyObservedPlatform::Other
    }
}

fn observed_browser(user_agent: &str) -> nook_core::PasskeyObservedBrowser {
    if user_agent.contains("OPR/") {
        nook_core::PasskeyObservedBrowser::Other
    } else if user_agent.contains("Edg/")
        || user_agent.contains("EdgA/")
        || user_agent.contains("EdgiOS/")
    {
        nook_core::PasskeyObservedBrowser::Edge
    } else if user_agent.contains("Firefox/") || user_agent.contains("FxiOS/") {
        nook_core::PasskeyObservedBrowser::Firefox
    } else if user_agent.contains("CriOS/") || user_agent.contains("Chrome/") {
        nook_core::PasskeyObservedBrowser::Chrome
    } else if user_agent.contains("Safari/") {
        nook_core::PasskeyObservedBrowser::Safari
    } else {
        nook_core::PasskeyObservedBrowser::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_backup_flags_without_claiming_provider_identity() {
        let mut data = vec![0; 53];
        data[32] = 0x08;
        assert_eq!(backup_state(&data), nook_core::PasskeyBackupState::Eligible);
        data[32] = 0x18;
        assert_eq!(backup_state(&data), nook_core::PasskeyBackupState::BackedUp);
        data[32] = 0;
        assert_eq!(
            backup_state(&data),
            nook_core::PasskeyBackupState::NotEligible
        );
    }

    #[test]
    fn formats_only_nonzero_attested_aaguid() {
        let mut data = vec![0; 53];
        data[32] = 0x40;
        assert_eq!(aaguid(&data), None);
        data[37..53].copy_from_slice(&[1; 16]);
        assert_eq!(
            aaguid(&data).as_deref(),
            Some("01010101-0101-0101-0101-010101010101")
        );
    }

    #[test]
    fn recognizes_ios_browser_tokens_before_safari_fallback() {
        assert_eq!(
            observed_browser("Mozilla/5.0 FxiOS/140.0 Mobile/15E148 Safari/605.1.15"),
            nook_core::PasskeyObservedBrowser::Firefox
        );
        assert_eq!(
            observed_browser("Mozilla/5.0 EdgiOS/140.0 Mobile/15E148 Safari/605.1.15"),
            nook_core::PasskeyObservedBrowser::Edge
        );
    }

    #[test]
    fn recognizes_edge_on_android_before_the_generic_chrome_token() {
        assert_eq!(
            observed_browser(
                "Mozilla/5.0 (Linux; Android 15) Chrome/151.0.0.0 Mobile Safari/537.36 EdgA/151.0"
            ),
            nook_core::PasskeyObservedBrowser::Edge
        );
    }

    #[test]
    fn distinguishes_touch_capable_ipad_desktop_mode_from_macos() {
        let desktop_safari =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15";
        assert_eq!(
            observed_platform(desktop_safari, 5),
            nook_core::PasskeyObservedPlatform::AppleMobile
        );
        assert_eq!(
            observed_platform(desktop_safari, 0),
            nook_core::PasskeyObservedPlatform::MacOs
        );
    }

    #[test]
    fn recognizes_opera_before_the_generic_chrome_token() {
        assert_eq!(
            observed_browser("Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 OPR/117.0.0.0"),
            nook_core::PasskeyObservedBrowser::Other
        );
    }
}
