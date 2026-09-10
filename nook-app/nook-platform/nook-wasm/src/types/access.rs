use super::wasm_bindgen;
use crate::BrowserPasskeyRequestOptions;
use crate::passkey_browser;
use crate::{BrowserPasskeyClient, BrowserPasskeyCreationOptions};

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeySetup {
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeySetup {
    pub(crate) fn from_core(setup: &nook_core::DeviceKeyProtectionSetup) -> Self {
        Self {
            user_handle: setup.user_handle().as_ref().to_vec(),
            prf_input: setup.prf_input().as_ref().to_vec(),
        }
    }
}

#[wasm_bindgen]
impl NookPasskeySetup {
    #[wasm_bindgen(getter, js_name = userHandle)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `user_handle` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub fn user_handle(&self) -> Vec<u8> {
        self.user_handle.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `prf_input` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen]
    pub fn creation_options(
        &self,
        rp_id: &str,
        rp_name: &str,
    ) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
        BrowserPasskeyClient::creation_options(BrowserPasskeyCreationOptions {
            rp_id: rp_id,
            rp_name: rp_name,
            passkey_label: passkey_browser::DEFAULT_PASSKEY_LABEL,
            user_handle: &self.user_handle,
            prf_input: &self.prf_input,
        })
    }

    /// Build browser registration options with the label chosen by the caller.
    /// The browser ceremony remains in the presentation layer; this only
    /// prepares the typed `WebAuthn` request from Rust-owned setup material.
    #[wasm_bindgen]
    pub fn creation_options_with_label(
        &self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
        BrowserPasskeyClient::creation_options(BrowserPasskeyCreationOptions {
            rp_id: rp_id,
            rp_name: rp_name,
            passkey_label: passkey_label,
            user_handle: &self.user_handle,
            prf_input: &self.prf_input,
        })
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyUnlockOptions {
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeyUnlockOptions {
    pub(crate) fn from_core(
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<Self, nook_core::DeviceKeyProtectionError> {
        let request = record.assertion_request()?;
        Ok(Self {
            credential_id: request.credential_id().as_ref().to_vec(),
            prf_input: request.prf_input().as_ref().to_vec(),
        })
    }
}

#[wasm_bindgen]
impl NookPasskeyUnlockOptions {
    #[wasm_bindgen(getter, js_name = credentialId)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `credential_id` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub fn credential_id(&self) -> Vec<u8> {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `prf_input` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen]
    pub fn request_options(
        &self,
        rp_id: &str,
    ) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
        BrowserPasskeyClient::request_options(BrowserPasskeyRequestOptions {
            rp_id: rp_id,
            credential_id: &self.credential_id,
            prf_input: &self.prf_input,
        })
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookJoinRequest {
    device_id: String,
    public_key: String,
    requested_at: String,
}

#[wasm_bindgen]
impl NookJoinRequest {
    pub(crate) fn from_core(join: nook_core::JoinRequest) -> Self {
        Self {
            device_id: join.device_id.to_string(),
            public_key: join.public_key.as_str().to_owned(),
            requested_at: join.requested_at,
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = requestedAt)]
    pub fn requested_at(&self) -> String {
        self.requested_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultMember {
    auth_id: String,
    device_id: String,
    public_key: String,
    enrolled_at: String,
    label: String,
}

#[wasm_bindgen]
impl NookVaultMember {
    /// Snapshot public enrollment metadata while the live vault retains its join record.
    pub(crate) fn from_enrolled_join(
        join: &nook_core::JoinRequest,
    ) -> Result<Self, nook_core::MultiDeviceError> {
        Ok(Self {
            auth_id: join.public_key.auth_id()?.to_string(),
            device_id: join.device_id.to_string(),
            public_key: join.public_key.as_str().to_owned(),
            enrolled_at: join.requested_at.clone(),
            label: String::new(),
        })
    }

    pub(crate) fn from_core(member: nook_core::VaultMember) -> Self {
        Self {
            auth_id: member.auth_id.to_string(),
            device_id: member.device_id.to_string(),
            public_key: member.public_key.as_str().to_owned(),
            enrolled_at: member.enrolled_at,
            label: member.label.unwrap_or_default(),
        }
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = enrolledAt)]
    pub fn enrolled_at(&self) -> String {
        self.enrolled_at.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasswordEntrySummary {
    id: String,
    label: String,
    created_at: String,
}

#[wasm_bindgen]
impl NookPasswordEntrySummary {
    pub(crate) fn from_core(entry: &nook_core::PasswordUnlockEntry) -> Self {
        Self {
            id: entry.id.clone(),
            label: entry.label.clone(),
            created_at: entry.created_at.clone(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> String {
        self.created_at.clone()
    }
}

impl NookPasswordEntrySummary {
    pub(crate) fn password_entries_to_vec(
        entries: &[nook_core::PasswordUnlockEntry],
    ) -> Vec<NookPasswordEntrySummary> {
        entries
            .iter()
            .map(NookPasswordEntrySummary::from_core)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn access_wrappers_project_owned_bytes_and_metadata() {
        let setup = NookPasskeySetup {
            user_handle: vec![1, 2, 3],
            prf_input: vec![4, 5],
        };
        assert_eq!(setup.user_handle(), vec![1, 2, 3]);
        assert_eq!(setup.prf_input(), vec![4, 5]);

        let unlock = NookPasskeyUnlockOptions {
            credential_id: vec![9, 8],
            prf_input: vec![7, 6],
        };
        assert_eq!(unlock.credential_id(), vec![9, 8]);
        assert_eq!(unlock.prf_input(), vec![7, 6]);

        let join = NookJoinRequest {
            device_id: "device-1".into(),
            public_key: "public-key".into(),
            requested_at: "2026-01-01".into(),
        };
        assert_eq!(join.device_id(), "device-1");
        assert_eq!(join.public_key(), "public-key");
        assert_eq!(join.requested_at(), "2026-01-01");

        let member = NookVaultMember {
            auth_id: "auth-1".into(),
            device_id: "device-1".into(),
            public_key: "public-key".into(),
            enrolled_at: "2026-01-02".into(),
            label: "Alice".into(),
        };
        assert_eq!(member.auth_id(), "auth-1");
        assert_eq!(member.device_id(), "device-1");
        assert_eq!(member.public_key(), "public-key");
        assert_eq!(member.enrolled_at(), "2026-01-02");
        assert_eq!(member.label(), "Alice");

        let entry = NookPasswordEntrySummary {
            id: "entry-1".into(),
            label: "Recovery".into(),
            created_at: "2026-01-03".into(),
        };
        assert_eq!(entry.id(), "entry-1");
        assert_eq!(entry.label(), "Recovery");
        assert_eq!(entry.created_at(), "2026-01-03");
    }
}
