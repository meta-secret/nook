//! Best-effort, non-authoritative metadata reported by a WebAuthn ceremony.

use js_sys::{Array, Function, Reflect, Uint8Array};
use wasm_bindgen::{JsCast, JsValue};
use web_sys::PublicKeyCredential;

use crate::storage::device_access::PasskeyBrowserObservation;

pub(crate) fn observe(credential: &PublicKeyCredential) -> PasskeyBrowserObservation {
    let response: JsValue = credential.response().into();
    let authenticator_data = authenticator_data(&response);
    PasskeyBrowserObservation {
        attachment: attachment(credential),
        transports: transports(&response),
        backup_state: authenticator_data
            .as_deref()
            .map_or(nook_core::PasskeyBackupState::Unknown, backup_state),
        aaguid: authenticator_data.as_deref().and_then(aaguid),
        client_environment: client_environment(),
    }
}

fn attachment(credential: &PublicKeyCredential) -> nook_core::PasskeyAuthenticatorAttachment {
    let value = Reflect::get(credential.as_ref(), &JsValue::from_str("authenticatorAttachment"));
    match value.ok().and_then(|value| value.as_string()).as_deref() {
        Some("platform") => nook_core::PasskeyAuthenticatorAttachment::Platform,
        Some("cross-platform") => nook_core::PasskeyAuthenticatorAttachment::CrossPlatform,
        _ => nook_core::PasskeyAuthenticatorAttachment::Unknown,
    }
}

fn transports(response: &JsValue) -> Vec<String> {
    let Ok(method) = Reflect::get(response, &JsValue::from_str("getTransports")) else {
        return Vec::new();
    };
    let Some(method) = method.dyn_ref::<Function>() else {
        return Vec::new();
    };
    let Ok(value) = method.call0(response) else {
        return Vec::new();
    };
    let array = Array::from(&value);
    let mut values = Vec::new();
    for value in array.iter() {
        let Some(value) = value.as_string() else {
            continue;
        };
        if matches!(value.as_str(), "internal" | "hybrid" | "usb" | "nfc" | "ble")
            && !values.contains(&value)
        {
            values.push(value);
        }
    }
    values.sort();
    values
}

fn authenticator_data(response: &JsValue) -> Option<Vec<u8>> {
    let direct = Reflect::get(response, &JsValue::from_str("authenticatorData")).ok();
    let value = match direct.filter(|value| !value.is_null() && !value.is_undefined()) {
        Some(value) => value,
        None => {
            let method = Reflect::get(response, &JsValue::from_str("getAuthenticatorData")).ok()?;
            method.dyn_ref::<Function>()?.call0(response).ok()?
        }
    };
    let array = Uint8Array::new(&value);
    (!array.is_empty()).then(|| array.to_vec())
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

fn client_environment() -> Option<String> {
    let navigator: JsValue = gloo_utils::window().navigator().into();
    let user_agent = Reflect::get(&navigator, &JsValue::from_str("userAgent"))
        .ok()?
        .as_string()?;
    let browser = if user_agent.contains("Edg/") {
        "Edge"
    } else if user_agent.contains("Firefox/") {
        "Firefox"
    } else if user_agent.contains("CriOS/") || user_agent.contains("Chrome/") {
        "Chrome"
    } else if user_agent.contains("Safari/") {
        "Safari"
    } else {
        "Browser"
    };
    let platform = if user_agent.contains("Android") {
        "Android"
    } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
        "iOS or iPadOS"
    } else if user_agent.contains("Mac OS X") {
        "macOS"
    } else if user_agent.contains("Windows") {
        "Windows"
    } else if user_agent.contains("Linux") {
        "Linux"
    } else {
        "this platform"
    };
    Some(format!("{browser} on {platform}"))
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
