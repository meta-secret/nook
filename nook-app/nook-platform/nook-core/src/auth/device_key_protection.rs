//! Compatibility exports for device identity protection.

pub use nook_auth2::{
    AwaitingPasskeyAssertion, DeviceIdentityProtection, DeviceKeyProtectionSetup,
    DeviceKeyProtectionVersion, PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial,
    PasskeyDeviceProtectionMode, PasskeyIdentityUnlock, PasskeyProtectionInput,
    PasskeyRecordMetadata, PasskeyRecoveryInput, PasskeyRecoveryRequest, PasskeyRegistration,
    PasskeyRegistrationInput, PasskeyRegistrationOutcome, PasskeyRegistrationPrfOutput,
    PasskeyRegistrationResolution, WebAuthnCredentialId, WebAuthnPrfInput, WebAuthnPrfOutput,
    WebAuthnUserHandle, WrappedDeviceIdentity,
};
