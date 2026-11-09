//! The device suffix Nook writes into passkey display names, so a person can
//! tell which device a passkey belongs to.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::DeviceId;

/// A device id shortened for a passkey's display name.
pub struct PasskeyDeviceHint;

impl PasskeyDeviceHint {
    /// The device id's start and end around an ellipsis; a short id stays
    /// whole.
    #[must_use]
    pub fn of(device_id: &DeviceId) -> String {
        const PREFIX_LEN: usize = 6;
        const SUFFIX_LEN: usize = 4;

        let chars = device_id.as_str().chars().collect::<Vec<_>>();
        if chars.len() <= PREFIX_LEN + SUFFIX_LEN + 3 {
            return device_id.as_str().to_owned();
        }
        let prefix = chars.iter().take(PREFIX_LEN).collect::<String>();
        let suffix = chars
            .iter()
            .skip(chars.len() - SUFFIX_LEN)
            .collect::<String>();
        format!("{prefix}...{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_device_id_keeps_its_ends_around_an_ellipsis() -> anyhow::Result<()> {
        assert_eq!(
            PasskeyDeviceHint::of(&DeviceId::parse("0123456789abcdef")?),
            "012345...cdef"
        );
        Ok(())
    }
}
