//! Recorded credential metadata is owned by the credential that produced it.

use super::{DeviceAccessProfile, PasskeyAccessProfile};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum DeviceCredentialProfile {
    #[default]
    Unrecorded,
    Passkey(PasskeyAccessProfile),
}
impl DeviceCredentialProfile {
    pub(super) fn is_unrecorded(&self) -> bool {
        matches!(self, Self::Unrecorded)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("passkey credential metadata is not recorded")]
pub struct PasskeyMetadataUnrecorded;

impl DeviceAccessProfile {
    pub fn require_passkey(&self) -> Result<&PasskeyAccessProfile, PasskeyMetadataUnrecorded> {
        match &self.credential {
            DeviceCredentialProfile::Unrecorded => Err(PasskeyMetadataUnrecorded),
            DeviceCredentialProfile::Passkey(passkey) => Ok(passkey),
        }
    }
    pub fn require_passkey_mut(
        &mut self,
    ) -> Result<&mut PasskeyAccessProfile, PasskeyMetadataUnrecorded> {
        match &mut self.credential {
            DeviceCredentialProfile::Unrecorded => Err(PasskeyMetadataUnrecorded),
            DeviceCredentialProfile::Passkey(passkey) => Ok(passkey),
        }
    }
    pub fn into_passkey(self) -> Result<PasskeyAccessProfile, PasskeyMetadataUnrecorded> {
        match self.credential {
            DeviceCredentialProfile::Unrecorded => Err(PasskeyMetadataUnrecorded),
            DeviceCredentialProfile::Passkey(passkey) => Ok(passkey),
        }
    }
}
