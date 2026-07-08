//! Compatibility exports for device identity protection.

pub use nook_auth2::{
    DeviceKeyProtectionSetup, WrappedDeviceIdentity, derive_device_identity_from_passkey_prf,
    deterministic_passkey_prf_input, parse_wrapped_device_identity,
    passkey_derived_device_identity_record, serialize_wrapped_device_identity,
    unwrap_device_identity_with_pin, wrap_device_identity_with_pin,
};
