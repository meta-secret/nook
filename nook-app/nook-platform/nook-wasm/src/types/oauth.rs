use super::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthRefreshCredentialState {
    NotIssued,
    Token,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookOAuthRefreshCredential(pub(crate) nook_core::OAuthRefreshCredential);

#[wasm_bindgen]
impl NookOAuthRefreshCredential {
    #[wasm_bindgen(js_name = notIssued)]
    #[must_use]
    pub fn not_issued() -> Self {
        Self(nook_core::OAuthRefreshCredential::NotIssued)
    }

    #[wasm_bindgen(js_name = token)]
    #[must_use]
    pub fn token(value: String) -> Self {
        Self(nook_core::OAuthRefreshCredential::Token(value))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRefreshCredentialState {
        match &self.0 {
            nook_core::OAuthRefreshCredential::NotIssued => {
                NookOAuthRefreshCredentialState::NotIssued
            }
            nook_core::OAuthRefreshCredential::Token(_) => NookOAuthRefreshCredentialState::Token,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::OAuthRefreshCredential::NotIssued => Err(wasm_bindgen::JsError::new(
                "OAuth refresh token was not issued",
            )),
            nook_core::OAuthRefreshCredential::Token(value) => Ok(value.clone()),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthTokenExpiryState {
    Unknown,
    ExpiresAt,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookOAuthTokenExpiry(pub(crate) nook_core::OAuthTokenExpiry);

#[wasm_bindgen]
impl NookOAuthTokenExpiry {
    #[wasm_bindgen(js_name = unknown)]
    #[must_use]
    pub fn unknown() -> Self {
        Self(nook_core::OAuthTokenExpiry::Unknown)
    }

    #[wasm_bindgen(js_name = expiresAt)]
    #[must_use]
    pub fn expires_at(value: String) -> Self {
        Self(nook_core::OAuthTokenExpiry::ExpiresAt(value))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthTokenExpiryState {
        match &self.0 {
            nook_core::OAuthTokenExpiry::Unknown => NookOAuthTokenExpiryState::Unknown,
            nook_core::OAuthTokenExpiry::ExpiresAt(_) => NookOAuthTokenExpiryState::ExpiresAt,
        }
    }

    #[wasm_bindgen(getter, js_name = value)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::OAuthTokenExpiry::Unknown => {
                Err(wasm_bindgen::JsError::new("OAuth token expiry is unknown"))
            }
            nook_core::OAuthTokenExpiry::ExpiresAt(value) => Ok(value.clone()),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthRemoteFileState {
    Unresolved,
    FileId,
    FileName,
    Identified,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookOAuthRemoteFile(pub(crate) nook_core::OAuthRemoteFile);

#[wasm_bindgen]
impl NookOAuthRemoteFile {
    #[wasm_bindgen(js_name = unresolved)]
    #[must_use]
    pub fn unresolved() -> Self {
        Self(nook_core::OAuthRemoteFile::Unresolved)
    }

    #[wasm_bindgen(js_name = fileId)]
    #[must_use]
    pub fn file_id(file_id: String) -> Self {
        Self(nook_core::OAuthRemoteFile::FileId { file_id })
    }

    #[wasm_bindgen(js_name = fileName)]
    #[must_use]
    pub fn file_name(file_name: String) -> Self {
        Self(nook_core::OAuthRemoteFile::FileName { file_name })
    }

    #[wasm_bindgen(js_name = identified)]
    #[must_use]
    pub fn identified(file_id: String, file_name: String) -> Self {
        Self(nook_core::OAuthRemoteFile::Identified { file_id, file_name })
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRemoteFileState {
        match &self.0 {
            nook_core::OAuthRemoteFile::Unresolved => NookOAuthRemoteFileState::Unresolved,
            nook_core::OAuthRemoteFile::FileId { .. } => NookOAuthRemoteFileState::FileId,
            nook_core::OAuthRemoteFile::FileName { .. } => NookOAuthRemoteFileState::FileName,
            nook_core::OAuthRemoteFile::Identified { .. } => NookOAuthRemoteFileState::Identified,
        }
    }

    #[wasm_bindgen(getter, js_name = fileIdValue)]
    pub fn file_id_value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::OAuthRemoteFile::FileId { file_id }
            | nook_core::OAuthRemoteFile::Identified { file_id, .. } => Ok(file_id.clone()),
            nook_core::OAuthRemoteFile::Unresolved
            | nook_core::OAuthRemoteFile::FileName { .. } => Err(wasm_bindgen::JsError::new(
                "OAuth remote file has no file id",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = fileNameValue)]
    pub fn file_name_value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::OAuthRemoteFile::FileName { file_name }
            | nook_core::OAuthRemoteFile::Identified { file_name, .. } => Ok(file_name.clone()),
            nook_core::OAuthRemoteFile::Unresolved | nook_core::OAuthRemoteFile::FileId { .. } => {
                Err(wasm_bindgen::JsError::new(
                    "OAuth remote file has no file name",
                ))
            }
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookOAuthAccountIdentityState {
    Unknown,
    Email,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookOAuthAccountIdentity(pub(crate) nook_core::OAuthAccountIdentity);

#[wasm_bindgen]
impl NookOAuthAccountIdentity {
    #[wasm_bindgen(js_name = unknown)]
    #[must_use]
    pub fn unknown() -> Self {
        Self(nook_core::OAuthAccountIdentity::Unknown)
    }

    #[wasm_bindgen(js_name = email)]
    #[must_use]
    pub fn email(value: String) -> Self {
        Self(nook_core::OAuthAccountIdentity::Email(value))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthAccountIdentityState {
        match &self.0 {
            nook_core::OAuthAccountIdentity::Unknown => NookOAuthAccountIdentityState::Unknown,
            nook_core::OAuthAccountIdentity::Email(_) => NookOAuthAccountIdentityState::Email,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::OAuthAccountIdentity::Unknown => Err(wasm_bindgen::JsError::new(
                "OAuth account identity is unknown",
            )),
            nook_core::OAuthAccountIdentity::Email(value) => Ok(value.clone()),
        }
    }
}
