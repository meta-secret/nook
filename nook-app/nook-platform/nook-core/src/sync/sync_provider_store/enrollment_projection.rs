//! Enrollment-to-provider configuration projection retains canonical OAuth state ownership.
use crate::{
    EnrollmentProvider, EnrollmentProviderDataRef, OAuthAccountIdentity, OAuthFileConfigData,
    OAuthRefreshCredential, OAuthRemoteFile, OAuthTokenExpiry, OauthFilePreset,
    PersonalEnrollmentProviderData, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
    StoredOAuthRefreshCredential, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    StoredOAuthTokenExpiry, ValidationError,
};

#[derive(Debug, thiserror::Error)]
pub enum EnrollmentOAuthConfigurationError {
    #[error("Enrollment provider does not carry personal OAuth configuration.")]
    NotPersonalOAuth,
    #[error(transparent)]
    InvalidPreset(#[from] ValidationError),
}
pub struct EnrollmentOAuthConfigurationRequest<'a> {
    pub provider: &'a EnrollmentProvider,
    pub defaults: OAuthFileConfigData,
}
impl EnrollmentOAuthConfigurationRequest<'_> {
    pub fn project(self) -> Result<OAuthFileConfigData, EnrollmentOAuthConfigurationError> {
        let EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile {
            preset,
            access_token,
            refresh,
            expiry,
            remote_file,
            account,
        }) = self.provider.data()
        else {
            return Err(EnrollmentOAuthConfigurationError::NotPersonalOAuth);
        };
        let mut config = self.defaults;
        config.preset = OauthFilePreset::parse(preset)?;
        config.access_token = StoredOAuthAccessCredential::AccessToken(access_token.clone());
        config.refresh_token = match refresh {
            OAuthRefreshCredential::NotIssued => StoredOAuthRefreshCredential::NotIssued,
            OAuthRefreshCredential::Token(token) => {
                StoredOAuthRefreshCredential::Token(token.clone())
            }
        };
        config.expires_at = match expiry {
            OAuthTokenExpiry::Unknown => StoredOAuthTokenExpiry::Unknown,
            OAuthTokenExpiry::ExpiresAt(value) => StoredOAuthTokenExpiry::ExpiresAt(value.clone()),
        };
        let (file_id, file_name) = match remote_file {
            OAuthRemoteFile::Unresolved => (
                StoredOAuthRemoteFileId::Unresolved,
                StoredOAuthRemoteFileName::Unresolved,
            ),
            OAuthRemoteFile::FileId { file_id } => (
                StoredOAuthRemoteFileId::FileId(file_id.clone()),
                StoredOAuthRemoteFileName::Unresolved,
            ),
            OAuthRemoteFile::FileName { file_name } => (
                StoredOAuthRemoteFileId::Unresolved,
                StoredOAuthRemoteFileName::FileName(file_name.clone()),
            ),
            OAuthRemoteFile::Identified { file_id, file_name } => (
                StoredOAuthRemoteFileId::FileId(file_id.clone()),
                StoredOAuthRemoteFileName::FileName(file_name.clone()),
            ),
        };
        config.file_id = file_id;
        config.file_name = file_name;
        config.account_email = match account {
            OAuthAccountIdentity::Unknown => StoredOAuthAccountIdentity::Unknown,
            OAuthAccountIdentity::Email(email) => StoredOAuthAccountIdentity::Email(email.clone()),
        };
        Ok(config)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::PersonalEnrollmentProvider;
    #[test]
    fn local_provider_cannot_be_reinterpreted_as_oauth() {
        let provider = EnrollmentProvider::personal(PersonalEnrollmentProvider::local());
        assert!(matches!(
            EnrollmentOAuthConfigurationRequest {
                provider: &provider,
                defaults: OAuthFileConfigData::default()
            }
            .project(),
            Err(EnrollmentOAuthConfigurationError::NotPersonalOAuth)
        ));
    }
    #[test]
    fn oauth_projection_preserves_missing_state_and_complete_remote_identity() -> anyhow::Result<()>
    {
        let provider = EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
            "google-drive".into(),
            "access".into(),
            OAuthRefreshCredential::NotIssued,
            OAuthTokenExpiry::Unknown,
            OAuthRemoteFile::Identified {
                file_id: "id".into(),
                file_name: "name".into(),
            },
            OAuthAccountIdentity::Unknown,
        ));
        let config = EnrollmentOAuthConfigurationRequest {
            provider: &provider,
            defaults: OAuthFileConfigData::default(),
        }
        .project()?;
        assert_eq!(config.file_id, StoredOAuthRemoteFileId::FileId("id".into()));
        assert_eq!(
            config.file_name,
            StoredOAuthRemoteFileName::FileName("name".into())
        );
        assert_eq!(
            config.refresh_token,
            StoredOAuthRefreshCredential::NotIssued
        );
        Ok(())
    }
}
