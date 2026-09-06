use super::{
    CREDENTIAL_ID_MAX_LEN, DeviceKeyProtectionError, DeviceKeyProtectionResult, PRF_INPUT_LEN,
    PRF_OUTPUT_LEN, USER_HANDLE_MAX_LEN,
};
use std::fmt;
use zeroize::Zeroize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebAuthnCredentialId(Vec<u8>);

impl TryFrom<Vec<u8>> for WebAuthnCredentialId {
    type Error = DeviceKeyProtectionError;

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: validates a WebAuthn credential-id ArrayBuffer"
        )
    )]
    fn try_from(value: Vec<u8>) -> DeviceKeyProtectionResult<Self> {
        if value.is_empty() {
            Err(DeviceKeyProtectionError::CredentialIdEmpty)
        } else if value.len() > CREDENTIAL_ID_MAX_LEN {
            Err(DeviceKeyProtectionError::CredentialIdTooLarge)
        } else {
            Ok(Self(value))
        }
    }
}

impl AsRef<[u8]> for WebAuthnCredentialId {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects a WebAuthn credential id to ArrayBuffer bytes"
        )
    )]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebAuthnUserHandle(Vec<u8>);

impl TryFrom<Vec<u8>> for WebAuthnUserHandle {
    type Error = DeviceKeyProtectionError;

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: validates a WebAuthn user-handle ArrayBuffer"
        )
    )]
    fn try_from(value: Vec<u8>) -> DeviceKeyProtectionResult<Self> {
        if value.is_empty() || value.len() > USER_HANDLE_MAX_LEN {
            Err(DeviceKeyProtectionError::UserHandleInvalid)
        } else {
            Ok(Self(value))
        }
    }
}

impl AsRef<[u8]> for WebAuthnUserHandle {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects a WebAuthn user handle to ArrayBuffer bytes"
        )
    )]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebAuthnPrfInput([u8; PRF_INPUT_LEN]);

impl WebAuthnPrfInput {
    pub(super) const fn from_validated(value: [u8; PRF_INPUT_LEN]) -> Self {
        Self(value)
    }
}

impl TryFrom<Vec<u8>> for WebAuthnPrfInput {
    type Error = DeviceKeyProtectionError;

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: validates a WebAuthn PRF-input ArrayBuffer"
        )
    )]
    fn try_from(value: Vec<u8>) -> DeviceKeyProtectionResult<Self> {
        value
            .try_into()
            .map(Self)
            .map_err(|_| DeviceKeyProtectionError::PrfInputInvalid)
    }
}

impl AsRef<[u8]> for WebAuthnPrfInput {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects a WebAuthn PRF input to ArrayBuffer bytes"
        )
    )]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct WebAuthnPrfOutput([u8; PRF_OUTPUT_LEN]);

impl fmt::Debug for WebAuthnPrfOutput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("WebAuthnPrfOutput(<redacted>)")
    }
}

impl Drop for WebAuthnPrfOutput {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl TryFrom<Vec<u8>> for WebAuthnPrfOutput {
    type Error = DeviceKeyProtectionError;

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: validates a WebAuthn PRF-output ArrayBuffer"
        )
    )]
    fn try_from(value: Vec<u8>) -> DeviceKeyProtectionResult<Self> {
        value
            .try_into()
            .map(Self)
            .map_err(|_| DeviceKeyProtectionError::PrfOutputInvalid)
    }
}

impl AsRef<[u8]> for WebAuthnPrfOutput {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects a WebAuthn PRF output to ArrayBuffer bytes"
        )
    )]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}
