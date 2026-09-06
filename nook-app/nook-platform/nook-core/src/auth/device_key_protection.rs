//! Compatibility exports for device identity protection.

pub use nook_auth2::{
    AwaitingPasskeyAssertion, DeviceKeyProtectionSetup, DeviceKeyProtectionVersion,
    PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial, PasskeyDeviceProtectionMode,
    PasskeyIdentityUnlock, PasskeyRecoveryInput, PasskeyRecoveryRequest, PasskeyRegistration,
    PasskeyRegistrationInput, PasskeyRegistrationOutcome, PasskeyRegistrationPrfOutput,
    PasskeyRegistrationResolution, WebAuthnCredentialId, WebAuthnPrfInput, WebAuthnPrfOutput,
    WebAuthnUserHandle, WrappedDeviceIdentity, parse_wrapped_device_identity,
    passkey_derived_device_identity_record, passkey_wrapped_device_identity_record,
    serialize_wrapped_device_identity, unwrap_device_identity_with_pin,
    wrap_device_identity_with_pin,
};
