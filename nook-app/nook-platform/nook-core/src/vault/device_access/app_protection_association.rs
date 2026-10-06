//! Descriptive peer protection evidence, never a local unlock capability.

use crate::{
    AppId, DeviceAccessProtectionKind, DeviceCredentialProfile, PasskeyAccessProfile,
    WrappedDeviceIdentity,
};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq)]
pub enum AppProtectionAppBinding {
    Matched,
    DifferentApp,
}

pub struct AppProtectionAppBindingRequest<'a> {
    pub observed: &'a AppId,
    pub expected: &'a AppId,
}

impl AppProtectionAppBindingRequest<'_> {
    #[must_use]
    pub fn classify(self) -> AppProtectionAppBinding {
        match self.observed.cmp(self.expected) {
            Ordering::Equal => AppProtectionAppBinding::Matched,
            Ordering::Less | Ordering::Greater => AppProtectionAppBinding::DifferentApp,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum AppProtectionAssociation {
    Unknown,
    PasskeyStandard(PasskeyAccessProfile),
    PasskeyAntiHacker(PasskeyAccessProfile),
    PinOrPassphrase,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct AppProtectionDescriptor {
    pub app_id: AppId,
    pub association: AppProtectionAssociation,
}

pub struct AppProtectionDescriptorSource<'a> {
    pub app_id: &'a AppId,
    pub wrapped: &'a WrappedDeviceIdentity,
    pub credential: &'a DeviceCredentialProfile,
}

#[derive(Debug, thiserror::Error)]
pub enum AppProtectionDescriptorError {
    #[error(transparent)]
    Credential(#[from] crate::DeviceKeyProtectionError),
    #[error("Passkey profile does not match protected credential")]
    ProfileMismatch,
}

impl AppProtectionDescriptor {
    pub fn from_protected(
        source: AppProtectionDescriptorSource<'_>,
    ) -> Result<Self, AppProtectionDescriptorError> {
        let association = match source.wrapped {
            WrappedDeviceIdentity::PasskeyDerived(_) => {
                AppProtectionAssociation::PasskeyStandard(source.passkey_profile()?)
            }
            WrappedDeviceIdentity::PasskeyWrappedLocal(_) => {
                AppProtectionAssociation::PasskeyAntiHacker(source.passkey_profile()?)
            }
            WrappedDeviceIdentity::Pin(_) => AppProtectionAssociation::PinOrPassphrase,
        };
        Ok(Self {
            app_id: source.app_id.clone(),
            association,
        })
    }
}

impl AppProtectionDescriptorSource<'_> {
    fn passkey_profile(&self) -> Result<PasskeyAccessProfile, AppProtectionDescriptorError> {
        let fingerprint =
            PasskeyAccessProfile::credential_identifier(self.wrapped.credential_id()?.as_ref());
        match self.credential {
            DeviceCredentialProfile::Passkey(profile)
                if profile.credential_fingerprint == fingerprint =>
            {
                Ok(profile.clone())
            }
            DeviceCredentialProfile::Passkey(_) => {
                Err(AppProtectionDescriptorError::ProfileMismatch)
            }
            DeviceCredentialProfile::Unrecorded => Ok(PasskeyAccessProfile {
                credential_fingerprint: fingerprint,
                ..PasskeyAccessProfile::default()
            }),
        }
    }
}

impl AppProtectionAssociation {
    #[must_use]
    pub fn protection_kind(&self) -> DeviceAccessProtectionKind {
        match self {
            Self::Unknown => DeviceAccessProtectionKind::Missing,
            Self::PasskeyStandard(_) => DeviceAccessProtectionKind::PasskeyStandard,
            Self::PasskeyAntiHacker(_) => DeviceAccessProtectionKind::PasskeyAntiHacker,
            Self::PinOrPassphrase => DeviceAccessProtectionKind::PinOrPassphrase,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppKey, DeviceKeyProtectionSetup, PasskeyRecordMetadata, WebAuthnCredentialId};

    #[test]
    fn app_binding_names_matching_and_foreign_app_outcomes() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let foreign = AppKey::generate()?;
        assert_eq!(
            AppProtectionAppBindingRequest {
                observed: app.app_id(),
                expected: app.app_id()
            }
            .classify(),
            AppProtectionAppBinding::Matched
        );
        assert_eq!(
            AppProtectionAppBindingRequest {
                observed: app.app_id(),
                expected: foreign.app_id()
            }
            .classify(),
            AppProtectionAppBinding::DifferentApp
        );
        Ok(())
    }

    #[test]
    fn independent_credentials_keep_their_own_app_associations() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let browser = AppKey::generate()?;
        let extension = AppKey::generate()?;
        let mut descriptors = Vec::new();
        for (app_id, credential_bytes) in [
            (browser.app_id(), vec![7; 32]),
            (extension.app_id(), vec![8; 32]),
        ] {
            let credential_id = WebAuthnCredentialId::try_from(credential_bytes)?;
            let wrapped = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
                credential_id: &credential_id,
                user_handle: setup.user_handle(),
                prf_input: setup.prf_input(),
            })?;
            descriptors.push(AppProtectionDescriptor::from_protected(
                AppProtectionDescriptorSource {
                    app_id,
                    wrapped: &wrapped,
                    credential: &DeviceCredentialProfile::Unrecorded,
                },
            )?);
        }
        assert_eq!(descriptors[0].app_id, *browser.app_id());
        assert_eq!(descriptors[1].app_id, *extension.app_id());
        let AppProtectionAssociation::PasskeyStandard(browser_profile) =
            &descriptors[0].association
        else {
            anyhow::bail!("expected browser passkey");
        };
        let AppProtectionAssociation::PasskeyStandard(extension_profile) =
            &descriptors[1].association
        else {
            anyhow::bail!("expected extension passkey");
        };
        assert_ne!(
            browser_profile.credential_fingerprint,
            extension_profile.credential_fingerprint
        );
        assert!(extension_profile.nook_name.is_empty());
        let json = serde_json::to_string(&descriptors[1])?;
        assert!(!json.contains("prfInput"));
        assert!(!json.contains("credentialId"));
        assert!(!json.contains("ciphertext"));
        Ok(())
    }

    #[test]
    fn another_credentials_profile_is_rejected() -> anyhow::Result<()> {
        let setup = DeviceKeyProtectionSetup::generate()?;
        let app = AppKey::generate()?;
        let credential_id = WebAuthnCredentialId::try_from(vec![7; 32])?;
        let wrapped = WrappedDeviceIdentity::passkey_derived(&PasskeyRecordMetadata {
            credential_id: &credential_id,
            user_handle: setup.user_handle(),
            prf_input: setup.prf_input(),
        })?;
        let profile = DeviceCredentialProfile::Passkey(PasskeyAccessProfile {
            credential_fingerprint: PasskeyAccessProfile::credential_identifier(&[8; 32]),
            ..PasskeyAccessProfile::default()
        });
        assert!(matches!(
            AppProtectionDescriptor::from_protected(AppProtectionDescriptorSource {
                app_id: app.app_id(),
                wrapped: &wrapped,
                credential: &profile,
            }),
            Err(AppProtectionDescriptorError::ProfileMismatch)
        ));
        Ok(())
    }
}
