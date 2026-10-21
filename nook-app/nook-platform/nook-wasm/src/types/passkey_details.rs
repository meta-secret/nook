use super::wasm_bindgen;
use nook_core::{ResolvedPasskeyDetails, SecretId};

/// Whether an optional passkey name adds information to the detail panel.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookPasskeyNameState {
    /// The name is empty or repeats another shown field; its row does not apply.
    Repeated,
    /// The name is distinct; its text getter carries it.
    Distinct,
}

impl NookPasskeyNameState {
    fn of(name: Option<&String>) -> Self {
        name.map_or(Self::Repeated, |_| Self::Distinct)
    }
}

/// Public facts about one stored passkey for the vault detail panel.
///
/// Built from a freshly decrypted record; the private key never reaches this
/// wrapper. Label getters return Rust-owned translation keys.
#[wasm_bindgen]
pub struct NookPasskeyDetails {
    inner: nook_core::PasskeyDetails,
    current_record_id: SecretId,
}

impl NookPasskeyDetails {
    pub(crate) fn from_core(resolved: ResolvedPasskeyDetails) -> Self {
        Self {
            inner: resolved.details,
            current_record_id: resolved.current_record_id,
        }
    }
}

#[wasm_bindgen]
impl NookPasskeyDetails {
    /// Live record selected in the same signed vault snapshot as these details.
    #[wasm_bindgen(getter, js_name = currentRecordId)]
    #[must_use]
    pub fn current_record_id(&self) -> String {
        self.current_record_id.to_string()
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    #[must_use]
    pub fn credential_id(&self) -> String {
        self.inner.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = relyingPartyNameState)]
    #[must_use]
    pub fn relying_party_name_state(&self) -> NookPasskeyNameState {
        NookPasskeyNameState::of(self.inner.relying_party_name.as_ref())
    }

    /// Website display name; empty when its state is `Repeated`.
    #[wasm_bindgen(getter, js_name = relyingPartyName)]
    #[must_use]
    pub fn relying_party_name(&self) -> String {
        self.inner.relying_party_name.clone().unwrap_or_default()
    }

    #[wasm_bindgen(getter, js_name = userNameState)]
    #[must_use]
    pub fn user_name_state(&self) -> NookPasskeyNameState {
        NookPasskeyNameState::of(self.inner.distinct_user_name.as_ref())
    }

    /// Account user name; empty when its state is `Repeated`.
    #[wasm_bindgen(getter, js_name = userName)]
    #[must_use]
    pub fn user_name(&self) -> String {
        self.inner.distinct_user_name.clone().unwrap_or_default()
    }

    #[wasm_bindgen(getter, js_name = algorithmLabelKey)]
    #[must_use]
    pub fn algorithm_label_key(&self) -> String {
        self.inner.algorithm.translation_key().to_owned()
    }

    #[wasm_bindgen(getter, js_name = publicKeyFingerprint)]
    #[must_use]
    pub fn public_key_fingerprint(&self) -> String {
        self.inner.public_key_fingerprint.to_string()
    }

    #[wasm_bindgen(getter, js_name = signatureCount)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the passkey signature counter as a JavaScript Number scalar"
        )
    )]
    pub fn signature_count(&self) -> u32 {
        u32::from(self.inner.signature_count)
    }

    #[wasm_bindgen(getter, js_name = discoverableLabelKey)]
    #[must_use]
    pub fn discoverable_label_key(&self) -> String {
        self.inner.discoverability.translation_key().to_owned()
    }

    #[wasm_bindgen(getter, js_name = backupStatusLabelKey)]
    #[must_use]
    pub fn backup_status_label_key(&self) -> String {
        self.inner.backup_status.translation_key().to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use nook_core::{
        PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8, PasskeyPublicKeyCose,
        PasskeySecret, i18n_keys,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn passkey_details_wrapper_projects_public_facts_and_label_keys() -> anyhow::Result<()> {
        let passkey = PasskeySecret {
            version: PASSKEY_SECRET_VERSION,
            rp_id: "login.example.com".to_owned(),
            rp_name: "Example Login".to_owned(),
            credential_id: URL_SAFE_NO_PAD.encode([8_u8; 32]),
            user_handle: URL_SAFE_NO_PAD.encode([9_u8; 32]),
            user_name: "Alice".to_owned(),
            user_display_name: "Alice".to_owned(),
            key: PasskeyCredentialKey::Es256 {
                private_key_pkcs8: PasskeyPrivateKeyPkcs8::parse(
                    URL_SAFE_NO_PAD.encode([7_u8; 96]),
                )?,
                public_key_cose: PasskeyPublicKeyCose::parse(URL_SAFE_NO_PAD.encode([10_u8; 77]))?,
            },
            signature_count: 3.into(),
            discoverable: true,
            backup_eligible: true,
            backup_state: false,
        };

        let record_id = SecretId::generate()?;
        let details = NookPasskeyDetails::from_core(ResolvedPasskeyDetails {
            current_record_id: record_id.clone(),
            details: passkey.details()?,
        });

        assert_eq!(details.current_record_id(), record_id.as_str());
        assert_eq!(details.credential_id(), URL_SAFE_NO_PAD.encode([8_u8; 32]));
        assert_eq!(
            details.relying_party_name_state(),
            NookPasskeyNameState::Distinct
        );
        assert_eq!(details.relying_party_name(), "Example Login");
        assert_eq!(details.user_name_state(), NookPasskeyNameState::Repeated);
        assert_eq!(details.user_name(), "");
        assert_eq!(
            details.algorithm_label_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_ALGORITHM_ES256
        );
        assert_eq!(
            details.public_key_fingerprint(),
            "SHA256:9+DIAhGaEvPhUkquTXtzDLd10GrycDMuT91vONRZCiY"
        );
        assert_eq!(details.signature_count(), 3);
        assert_eq!(
            details.discoverable_label_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_DISCOVERABLE_YES
        );
        assert_eq!(
            details.backup_status_label_key(),
            i18n_keys::VAULT_FIELDS_PASSKEY_BACKUP_NOT_BACKED_UP
        );
        Ok(())
    }
}
