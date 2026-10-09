//! Minimum plaintext projection for an explicit focused-field fill.

use super::{LoginHostMatchRequest, LoginSiteHostsError};
use crate::{SecretRecord, SecretValue};
use serde::{Deserialize, Serialize};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

pub use nook_companion_core::credential_fill::CredentialKind;

/// Parsed requesting URL; matching remains owned by the existing host policy.
#[derive(Clone, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct FocusedLoginFillOrigin(Url);

impl TryFrom<String> for FocusedLoginFillOrigin {
    type Error = url::ParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Url::parse(&value).map(Self)
    }
}

impl From<FocusedLoginFillOrigin> for String {
    fn from(origin: FocusedLoginFillOrigin) -> Self {
        let FocusedLoginFillOrigin(url) = origin;
        url.into()
    }
}

impl FocusedLoginFillOrigin {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(url) = self;
        url.as_str()
    }
}

/// No record, second credential, notes, or host metadata survives this owner.
pub struct FocusedLoginFillCredential {
    value: Zeroizing<String>,
}

impl FocusedLoginFillCredential {
    #[must_use]
    pub fn as_str(&self) -> &str {
        self.value.as_str()
    }
}

impl Zeroize for FocusedLoginFillCredential {
    fn zeroize(&mut self) {
        self.value.zeroize();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FocusedLoginFillError {
    #[error("selected secret is not a login credential")]
    NotLogin,
    #[error("login does not match the requesting website origin")]
    OriginMismatch,
    #[error("login host policy is unavailable")]
    HostPolicy(#[from] LoginSiteHostsError),
}

pub struct FocusedLoginFillProjection<'a> {
    pub record: SecretRecord,
    pub origin: &'a FocusedLoginFillOrigin,
    pub credential: CredentialKind,
}

enum LoginOriginAdmission {
    Matched,
    Mismatched,
}

impl Drop for FocusedLoginFillProjection<'_> {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl Zeroize for FocusedLoginFillProjection<'_> {
    fn zeroize(&mut self) {
        self.record.zeroize_plaintext();
    }
}

impl FocusedLoginFillProjection<'_> {
    pub fn reveal(self) -> Result<FocusedLoginFillCredential, FocusedLoginFillError> {
        self.project_matching_login()
    }

    fn origin_admission(&self) -> Result<LoginOriginAdmission, FocusedLoginFillError> {
        let SecretValue::Login(login) = &self.record.data else {
            return Err(FocusedLoginFillError::NotLogin);
        };
        let matches = (LoginHostMatchRequest {
            website_url: &login.website_url,
            origin: self.origin.as_str(),
        })
        .matches()?;
        Ok(if matches {
            LoginOriginAdmission::Matched
        } else {
            LoginOriginAdmission::Mismatched
        })
    }

    fn project_matching_login(&self) -> Result<FocusedLoginFillCredential, FocusedLoginFillError> {
        let SecretValue::Login(login) = &self.record.data else {
            return Err(FocusedLoginFillError::NotLogin);
        };
        match self.origin_admission()? {
            LoginOriginAdmission::Mismatched => Err(FocusedLoginFillError::OriginMismatch),
            LoginOriginAdmission::Matched => Ok(FocusedLoginFillCredential {
                value: Zeroizing::new(match self.credential {
                    CredentialKind::Username => login.username.clone(),
                    CredentialKind::CurrentPassword => login.password.clone(),
                }),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LoginSecret, SecretId, SecretType};

    struct LoginFixture;

    impl LoginFixture {
        fn vk_record() -> SecretRecord {
            SecretRecord {
                id: SecretId::from_vault_record("secret_vk_login"),
                secret_type: SecretType::Login,
                data: SecretValue::Login(LoginSecret {
                    website_url: "https://vk.ru/login".to_owned(),
                    username: "vk-account".to_owned(),
                    password: "vk-password-only".to_owned(),
                    notes: "never-projected".to_owned(),
                }),
            }
        }

        fn record() -> SecretRecord {
            SecretRecord {
                id: SecretId::from_vault_record("secret_SMypl8K0w9a"),
                secret_type: SecretType::Login,
                data: SecretValue::Login(LoginSecret {
                    website_url: "https://microsoft.com/login".to_owned(),
                    username: "alice".to_owned(),
                    password: "password-only".to_owned(),
                    notes: "never-projected".to_owned(),
                }),
            }
        }
    }

    #[test]
    fn vk_current_password_reveal_accepts_explicit_identity_host() -> anyhow::Result<()> {
        for origin in [
            "https://id.vk.ru/auth",
            "https://vk.ru/login",
            "https://www.VK.ru/login?next=home",
        ] {
            let origin = FocusedLoginFillOrigin::try_from(origin.to_owned())?;
            let mut password = FocusedLoginFillProjection {
                record: LoginFixture::vk_record(),
                origin: &origin,
                credential: CredentialKind::CurrentPassword,
            }
            .reveal()?;
            assert_eq!(password.as_str(), "vk-password-only");
            password.zeroize();
            assert_eq!(password.as_str(), "");
        }
        Ok(())
    }

    #[test]
    fn vk_current_password_reveal_rejects_hosts_outside_explicit_family() -> anyhow::Result<()> {
        for origin in [
            "https://arbitrary.vk.ru/auth",
            "https://nested.id.vk.ru/auth",
            "https://id.vk.ru.evil.example/auth",
            "https://evil-vk.ru/auth",
            "https://vk.com/auth",
            "https://unrelated.example/auth",
        ] {
            let origin = FocusedLoginFillOrigin::try_from(origin.to_owned())?;
            assert!(matches!(
                FocusedLoginFillProjection {
                    record: LoginFixture::vk_record(),
                    origin: &origin,
                    credential: CredentialKind::CurrentPassword,
                }
                .reveal(),
                Err(FocusedLoginFillError::OriginMismatch)
            ));
        }
        Ok(())
    }

    #[test]
    fn projects_only_requested_value_on_same_or_related_host() -> anyhow::Result<()> {
        let origin =
            FocusedLoginFillOrigin::try_from("https://login.microsoftonline.com".to_owned())?;
        let username = FocusedLoginFillProjection {
            record: LoginFixture::record(),
            origin: &origin,
            credential: CredentialKind::Username,
        }
        .reveal()?;
        assert_eq!(username.as_str(), "alice");
        let origin = FocusedLoginFillOrigin::try_from("https://microsoft.com".to_owned())?;
        let mut password = FocusedLoginFillProjection {
            record: LoginFixture::record(),
            origin: &origin,
            credential: CredentialKind::CurrentPassword,
        }
        .reveal()?;
        assert_eq!(password.as_str(), "password-only");
        password.zeroize();
        assert_eq!(password.as_str(), "");
        Ok(())
    }

    #[test]
    fn refuses_origin_mismatch_and_nonlogin() -> anyhow::Result<()> {
        let origin = FocusedLoginFillOrigin::try_from("https://evil-microsoft.com".to_owned())?;
        assert!(matches!(
            FocusedLoginFillProjection {
                record: LoginFixture::record(),
                origin: &origin,
                credential: CredentialKind::Username
            }
            .reveal(),
            Err(FocusedLoginFillError::OriginMismatch)
        ));
        let mut record = LoginFixture::record();
        record.zeroize_plaintext();
        record.data = SecretValue::SecureNote(crate::SecureNoteSecret {
            title: "note".to_owned(),
            note: "not-a-credential".to_owned(),
        });
        assert!(matches!(
            FocusedLoginFillProjection {
                record,
                origin: &origin,
                credential: CredentialKind::CurrentPassword
            }
            .reveal(),
            Err(FocusedLoginFillError::NotLogin)
        ));
        Ok(())
    }

    #[test]
    fn projection_cleanup_erases_every_unused_plaintext_field() -> anyhow::Result<()> {
        let origin = FocusedLoginFillOrigin::try_from("https://microsoft.com".to_owned())?;
        let mut projection = FocusedLoginFillProjection {
            record: LoginFixture::record(),
            origin: &origin,
            credential: CredentialKind::Username,
        };
        let username = projection.project_matching_login()?;
        projection.zeroize();
        let SecretValue::Login(login) = &projection.record.data else {
            anyhow::bail!("fixture must remain a login with erased content");
        };
        assert_eq!(login.website_url, "");
        assert_eq!(login.username, "");
        assert_eq!(login.password, "");
        assert_eq!(login.notes, "");
        assert_eq!(username.as_str(), "alice");
        Ok(())
    }

    #[test]
    fn origin_parsing_rejects_invalid_input_and_preserves_url_structure() -> anyhow::Result<()> {
        assert!(FocusedLoginFillOrigin::try_from("https://".to_owned()).is_err());
        let origin =
            FocusedLoginFillOrigin::try_from("https://example.com/login?next=home".to_owned())?;
        assert_eq!(origin.as_str(), "https://example.com/login?next=home");
        let encoded = serde_json::to_string(&origin)?;
        let decoded: FocusedLoginFillOrigin = serde_json::from_str(&encoded)?;
        assert_eq!(decoded.as_str(), origin.as_str());
        assert!(serde_json::from_str::<FocusedLoginFillOrigin>("\"https://\"").is_err());
        Ok(())
    }
}
