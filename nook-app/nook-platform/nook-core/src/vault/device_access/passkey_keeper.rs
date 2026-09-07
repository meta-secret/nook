//! Named passkey keepers derived from authenticator GUIDs.
//!
//! Registration evidence may include an authenticator GUID. Mapping that GUID
//! to a product name is browser-reported display help. It is never proof that
//! Nook inventoried the keeper or opened an external password manager.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PasskeyKeeperKind {
    #[default]
    Unknown,
    ApplePasswords,
    GooglePasswordManager,
    Chrome,
    ProtonPass,
    OnePassword,
    Bitwarden,
    WindowsHello,
    Dashlane,
    Enpass,
    Keeper,
    NordPass,
    SamsungPass,
}

impl PasskeyKeeperKind {
    #[must_use]
    pub fn classify(aaguid: Option<&str>) -> Self {
        let Some(raw) = aaguid else {
            return Self::Unknown;
        };
        let Some(canonical) = Self::canonical_aaguid(raw) else {
            return Self::Unknown;
        };
        match canonical.as_str() {
            "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" | "dd4ec289-e01d-41c9-bb89-70fa845d4bf2" => {
                Self::ApplePasswords
            }
            "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4" => Self::GooglePasswordManager,
            "adce0002-35bc-c60a-648b-0b25f1f05503" => Self::Chrome,
            "50726f74-6f6e-5061-7373-50726f746f6e" => Self::ProtonPass,
            "bada5566-a7aa-401f-bd96-45619a55120d" => Self::OnePassword,
            "d548826e-79b4-db40-a3d8-11116f7e8349" => Self::Bitwarden,
            "08987058-cadc-4b81-b6e1-30de50dcbe96"
            | "9ddd1817-af5a-4672-a2b9-3e3dd95000a9"
            | "6028b017-b1d4-4c02-b4b3-afcdafc96bb2" => Self::WindowsHello,
            "531126d6-e717-415c-9320-3d9aa6981239" => Self::Dashlane,
            "f3809540-7f14-49c1-a8b3-8f813b225541" => Self::Enpass,
            "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6" => Self::Keeper,
            "b84e4048-15dc-4dd0-8640-f4f60813c8af" => Self::NordPass,
            "53414d53-554e-4700-0000-000000000000" => Self::SamsungPass,
            _ => Self::Unknown,
        }
    }

    fn canonical_aaguid(raw: &str) -> Option<String> {
        let compact: String = raw
            .chars()
            .filter(char::is_ascii_hexdigit)
            .map(|character| character.to_ascii_lowercase())
            .collect();
        if compact.len() != 32 || compact.bytes().all(|byte| byte == b'0') {
            return None;
        }
        let mut canonical = String::with_capacity(36);
        for (index, character) in compact.chars().enumerate() {
            if matches!(index, 8 | 12 | 16 | 20) {
                canonical.push('-');
            }
            canonical.push(character);
        }
        Some(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::PasskeyKeeperKind;

    #[test]
    fn apple_passwords_hyphenated_guid_maps() {
        assert_eq!(
            PasskeyKeeperKind::classify(Some("FBFC3007-154E-4ECC-8C0B-6E020557D7BD")),
            PasskeyKeeperKind::ApplePasswords
        );
    }

    #[test]
    fn proton_pass_compact_guid_maps() {
        assert_eq!(
            PasskeyKeeperKind::classify(Some("50726f746f6e5061737350726f746f6e")),
            PasskeyKeeperKind::ProtonPass
        );
    }

    #[test]
    fn google_password_manager_guid_maps() {
        assert_eq!(
            PasskeyKeeperKind::classify(Some("ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4")),
            PasskeyKeeperKind::GooglePasswordManager
        );
    }

    #[test]
    fn zero_guid_stays_unknown() {
        assert_eq!(
            PasskeyKeeperKind::classify(Some("00000000-0000-0000-0000-000000000000")),
            PasskeyKeeperKind::Unknown
        );
    }

    #[test]
    fn missing_guid_stays_unknown() {
        assert_eq!(
            PasskeyKeeperKind::classify(None),
            PasskeyKeeperKind::Unknown
        );
    }

    #[test]
    fn unrecognized_guid_stays_unknown() {
        assert_eq!(
            PasskeyKeeperKind::classify(Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")),
            PasskeyKeeperKind::Unknown
        );
    }
}
