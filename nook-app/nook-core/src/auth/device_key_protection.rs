//! Compatibility exports for device identity protection.

pub use nook_auth2::{
    DeviceKeyProtectionSetup, PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial,
    PasskeyRecoveryRequest, PasskeyRegistrationResolution, WrappedDeviceIdentity,
    derive_device_identity_from_passkey_prf, deterministic_passkey_prf_input,
    finish_passkey_device_identity, parse_wrapped_device_identity, passkey_assertion_request,
    passkey_derived_device_identity_record, passkey_recovery_request,
    recover_passkey_device_identity, resolve_passkey_registration,
    serialize_wrapped_device_identity, unlock_passkey_device_identity,
    unwrap_device_identity_with_pin, wrap_device_identity_with_pin,
};
