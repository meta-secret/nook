//! Compatibility exports for passkey-PRF device identity wrapping.

pub use nook_auth::{
    DEVICE_KEY_PROTECTION_VERSION, DeviceKeyProtectionSetup, WrappedDeviceIdentity,
    parse_wrapped_device_identity, serialize_wrapped_device_identity, unwrap_device_identity,
    wrap_device_identity,
};
