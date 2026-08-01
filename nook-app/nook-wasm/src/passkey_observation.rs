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
    let Ok(user_agent) = gloo_utils::window().navigator().user_agent() else {
        return PasskeyBrowserObservation::default();
    };
    let browser = if user_agent.contains("Edg/") {
        nook_core::PasskeyObservedBrowser::Edge
    } else if user_agent.contains("Firefox/") {
        nook_core::PasskeyObservedBrowser::Firefox
    } else if user_agent.contains("CriOS/") || user_agent.contains("Chrome/") {
        nook_core::PasskeyObservedBrowser::Chrome
    } else if user_agent.contains("Safari/") {
        nook_core::PasskeyObservedBrowser::Safari
    } else {
        nook_core::PasskeyObservedBrowser::Other
    };
    let platform = if user_agent.contains("Android") {
        nook_core::PasskeyObservedPlatform::Android
    } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
        nook_core::PasskeyObservedPlatform::AppleMobile
    } else if user_agent.contains("Mac OS X") {
        nook_core::PasskeyObservedPlatform::MacOs
    } else if user_agent.contains("Windows") {
        nook_core::PasskeyObservedPlatform::Windows
    } else if user_agent.contains("Linux") {
        nook_core::PasskeyObservedPlatform::Linux
    } else {
        nook_core::PasskeyObservedPlatform::Other
    };
    PasskeyBrowserObservation {
        browser,
        platform,
        ..PasskeyBrowserObservation::default()
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
}
