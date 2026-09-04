use super::wasm_bindgen;
use nook_core::{OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile, OAuthTokenExpiry};
use wasm_bindgen::JsError;

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
    #[wasm_bindgen]
    #[must_use]
    pub fn not_issued() -> Self {
        Self(OAuthRefreshCredential::NotIssued)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn token(value: String) -> Self {
        Self(OAuthRefreshCredential::Token(value))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRefreshCredentialState {
        match &self.0 {
            OAuthRefreshCredential::NotIssued => NookOAuthRefreshCredentialState::NotIssued,
            OAuthRefreshCredential::Token(_) => NookOAuthRefreshCredentialState::Token,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthRefreshCredential::NotIssued => {
                Err(JsError::new("OAuth refresh token was not issued"))
            }
            OAuthRefreshCredential::Token(value) => Ok(value.clone()),
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
    #[wasm_bindgen]
    #[must_use]
    pub fn unknown() -> Self {
        Self(OAuthTokenExpiry::Unknown)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn expires_at(value: String) -> Self {
        Self(OAuthTokenExpiry::ExpiresAt(value))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthTokenExpiryState {
        match &self.0 {
            OAuthTokenExpiry::Unknown => NookOAuthTokenExpiryState::Unknown,
            OAuthTokenExpiry::ExpiresAt(_) => NookOAuthTokenExpiryState::ExpiresAt,
        }
    }

    #[wasm_bindgen(getter, js_name = value)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthTokenExpiry::Unknown => Err(JsError::new("OAuth token expiry is unknown")),
            OAuthTokenExpiry::ExpiresAt(value) => Ok(value.clone()),
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
    #[wasm_bindgen]
    #[must_use]
    pub fn unresolved() -> Self {
        Self(OAuthRemoteFile::Unresolved)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn file_id(file_id: String) -> Self {
        Self(OAuthRemoteFile::FileId { file_id })
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn file_name(file_name: String) -> Self {
        Self(OAuthRemoteFile::FileName { file_name })
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn identified(file_id: String, file_name: String) -> Self {
        Self(OAuthRemoteFile::Identified { file_id, file_name })
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthRemoteFileState {
        match &self.0 {
            OAuthRemoteFile::Unresolved => NookOAuthRemoteFileState::Unresolved,
            OAuthRemoteFile::FileId { .. } => NookOAuthRemoteFileState::FileId,
            OAuthRemoteFile::FileName { .. } => NookOAuthRemoteFileState::FileName,
            OAuthRemoteFile::Identified { .. } => NookOAuthRemoteFileState::Identified,
        }
    }

    #[wasm_bindgen(getter, js_name = fileIdValue)]
    pub fn file_id_value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthRemoteFile::FileId { file_id } | OAuthRemoteFile::Identified { file_id, .. } => {
                Ok(file_id.clone())
            }
            OAuthRemoteFile::Unresolved | OAuthRemoteFile::FileName { .. } => {
                Err(JsError::new("OAuth remote file has no file id"))
            }
        }
    }

    #[wasm_bindgen(getter, js_name = fileNameValue)]
    pub fn file_name_value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthRemoteFile::FileName { file_name }
            | OAuthRemoteFile::Identified { file_name, .. } => Ok(file_name.clone()),
            OAuthRemoteFile::Unresolved | OAuthRemoteFile::FileId { .. } => {
                Err(JsError::new("OAuth remote file has no file name"))
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
    #[wasm_bindgen]
    #[must_use]
    pub fn unknown() -> Self {
        Self(OAuthAccountIdentity::Unknown)
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn email(value: String) -> Self {
        Self(OAuthAccountIdentity::Email(value))
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookOAuthAccountIdentityState {
        match &self.0 {
            OAuthAccountIdentity::Unknown => NookOAuthAccountIdentityState::Unknown,
            OAuthAccountIdentity::Email(_) => NookOAuthAccountIdentityState::Email,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            OAuthAccountIdentity::Unknown => Err(JsError::new("OAuth account identity is unknown")),
            OAuthAccountIdentity::Email(value) => Ok(value.clone()),
        }
    }
}
