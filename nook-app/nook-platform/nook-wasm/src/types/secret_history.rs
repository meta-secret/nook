use super::wasm_bindgen;
use nook_core::{SecretHistory, SecretHistoryDevice, SecretRevision};

/// Whether the item's origin names the device that created it.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookSecretOriginDeviceState {
    /// Imported or carried-forward items have no creating device row.
    NotApplicable,
    /// The origin device getters carry the creating device.
    Recorded,
}

/// Whether the item changed after its first recorded version.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookSecretRevisionState {
    /// The first recorded version is current; no modification rows apply.
    Original,
    /// The modification getters carry the current version's time and device.
    Revised,
}

/// One vault item's origin and last modification, for its detail panel.
///
/// Label getters return Rust-owned translation keys; a device value is the
/// `{device}` replacement for its key (empty when the key takes none). The
/// state getters say which rows apply; text getters of rows that do not apply
/// return empty strings.
#[wasm_bindgen]
pub struct NookSecretHistory {
    origin_label_key: String,
    origin_at: String,
    origin_device: Option<(String, String)>,
    modified: Option<(String, (String, String))>,
}

impl NookSecretHistory {
    fn device_parts(device: &SecretHistoryDevice) -> (String, String) {
        (device.translation_key().to_owned(), device.display_value())
    }

    pub(crate) fn from_core(history: &SecretHistory) -> Self {
        Self {
            origin_label_key: history.origin.translation_key().to_owned(),
            origin_at: history.origin.at().as_str().to_owned(),
            origin_device: history.origin.device().map(NookSecretHistory::device_parts),
            modified: match &history.revision {
                SecretRevision::Original => None,
                SecretRevision::Revised { at, device } => Some((
                    at.as_str().to_owned(),
                    NookSecretHistory::device_parts(device),
                )),
            },
        }
    }
}

#[wasm_bindgen]
impl NookSecretHistory {
    #[wasm_bindgen(getter, js_name = originLabelKey)]
    #[must_use]
    pub fn origin_label_key(&self) -> String {
        self.origin_label_key.clone()
    }

    /// RFC 3339 time of the item's first recorded version.
    #[wasm_bindgen(getter, js_name = originAt)]
    #[must_use]
    pub fn origin_at(&self) -> String {
        self.origin_at.clone()
    }

    #[wasm_bindgen(getter, js_name = originDeviceState)]
    #[must_use]
    pub fn origin_device_state(&self) -> NookSecretOriginDeviceState {
        self.origin_device
            .as_ref()
            .map_or(NookSecretOriginDeviceState::NotApplicable, |_| {
                NookSecretOriginDeviceState::Recorded
            })
    }

    #[wasm_bindgen(getter, js_name = originDeviceLabelKey)]
    #[must_use]
    pub fn origin_device_label_key(&self) -> String {
        self.origin_device
            .as_ref()
            .map_or_else(String::new, |(key, _)| key.clone())
    }

    #[wasm_bindgen(getter, js_name = originDeviceValue)]
    #[must_use]
    pub fn origin_device_value(&self) -> String {
        self.origin_device
            .as_ref()
            .map_or_else(String::new, |(_, value)| value.clone())
    }

    #[wasm_bindgen(getter, js_name = revisionState)]
    #[must_use]
    pub fn revision_state(&self) -> NookSecretRevisionState {
        self.modified
            .as_ref()
            .map_or(NookSecretRevisionState::Original, |_| {
                NookSecretRevisionState::Revised
            })
    }

    /// RFC 3339 time of the current version when `Revised`.
    #[wasm_bindgen(getter, js_name = modifiedAt)]
    #[must_use]
    pub fn modified_at(&self) -> String {
        self.modified
            .as_ref()
            .map_or_else(String::new, |(at, _)| at.clone())
    }

    #[wasm_bindgen(getter, js_name = modifiedDeviceLabelKey)]
    #[must_use]
    pub fn modified_device_label_key(&self) -> String {
        self.modified
            .as_ref()
            .map_or_else(String::new, |(_, (key, _))| key.clone())
    }

    #[wasm_bindgen(getter, js_name = modifiedDeviceValue)]
    #[must_use]
    pub fn modified_device_value(&self) -> String {
        self.modified
            .as_ref()
            .map_or_else(String::new, |(_, (_, value))| value.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{IsoTimestamp, SecretHistoryOrigin, i18n_keys};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn history_wrapper_projects_origin_and_revision_rows() {
        let created = NookSecretHistory::from_core(&SecretHistory {
            origin: SecretHistoryOrigin::Created {
                at: IsoTimestamp::from_trusted("2026-01-02T03:04:05Z".to_owned()),
                device: SecretHistoryDevice::ThisDevice,
            },
            revision: SecretRevision::Revised {
                at: IsoTimestamp::from_trusted("2026-03-01T00:00:00Z".to_owned()),
                device: SecretHistoryDevice::Unrecorded,
            },
        });
        assert_eq!(
            created.origin_label_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_CREATED
        );
        assert_eq!(created.origin_at(), "2026-01-02T03:04:05Z");
        assert_eq!(
            created.origin_device_state(),
            NookSecretOriginDeviceState::Recorded
        );
        assert_eq!(
            created.origin_device_label_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_THIS
        );
        assert_eq!(created.revision_state(), NookSecretRevisionState::Revised);
        assert_eq!(created.modified_at(), "2026-03-01T00:00:00Z");
        assert_eq!(
            created.modified_device_label_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_UNRECORDED
        );
        assert_eq!(created.modified_device_value(), "");

        let carried = NookSecretHistory::from_core(&SecretHistory {
            origin: SecretHistoryOrigin::CarriedForwardSince {
                at: IsoTimestamp::from_trusted("2026-05-05T00:00:00Z".to_owned()),
            },
            revision: SecretRevision::Original,
        });
        assert_eq!(
            carried.origin_label_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_IN_VAULT_SINCE
        );
        assert_eq!(
            carried.origin_device_state(),
            NookSecretOriginDeviceState::NotApplicable
        );
        assert_eq!(carried.origin_device_label_key(), "");
        assert_eq!(carried.origin_device_value(), "");
        assert_eq!(carried.revision_state(), NookSecretRevisionState::Original);
        assert_eq!(carried.modified_at(), "");
    }
}
