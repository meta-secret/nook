//! An identity invite handed to one installation: the passphrase that opens
//! the invite's enrollment code is sealed to that installation's app key, so
//! the code and the vault keys it carries open for no one else on the way.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{AgeArmoredCiphertext, DeviceIdentity, DevicePublicKey, VaultResult};
use zeroize::Zeroizing;

/// Seals an invite passphrase to the installation that will join with it.
/// The invite issuance checks the passphrase itself.
pub struct InvitePassphraseSeal<'a> {
    pub recipient: &'a DevicePublicKey,
    pub passphrase: &'a str,
}

impl InvitePassphraseSeal<'_> {
    pub fn seal(&self) -> VaultResult<AgeArmoredCiphertext> {
        Ok(self.recipient.seal_bytes(self.passphrase.as_bytes())?)
    }
}

/// Opens an invite passphrase sealed to this installation.
pub struct InvitePassphraseOpen<'a> {
    pub identity: &'a DeviceIdentity,
    pub sealed: &'a AgeArmoredCiphertext,
}

impl InvitePassphraseOpen<'_> {
    pub fn open(&self) -> VaultResult<Zeroizing<String>> {
        Ok(Zeroizing::new(self.identity.open_utf8(self.sealed)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_invited_installation_opens_its_passphrase() -> anyhow::Result<()> {
        let extension = DeviceIdentity::generate()?;
        let sealed = InvitePassphraseSeal {
            recipient: &extension.public_key(),
            passphrase: "kitten-orbit-lantern",
        }
        .seal()?;

        let opened = InvitePassphraseOpen {
            identity: &extension,
            sealed: &sealed,
        }
        .open()?;

        assert_eq!(opened.as_str(), "kitten-orbit-lantern");
        assert!(!sealed.as_str().contains("kitten-orbit-lantern"));
        Ok(())
    }

    #[test]
    fn another_installation_cannot_open_it() -> anyhow::Result<()> {
        let extension = DeviceIdentity::generate()?;
        let stranger = DeviceIdentity::generate()?;
        let sealed = InvitePassphraseSeal {
            recipient: &extension.public_key(),
            passphrase: "kitten-orbit-lantern",
        }
        .seal()?;

        let opened = InvitePassphraseOpen {
            identity: &stranger,
            sealed: &sealed,
        }
        .open();

        assert!(opened.is_err());
        Ok(())
    }
}
