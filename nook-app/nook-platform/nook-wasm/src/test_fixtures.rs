//! Rows and connections the nook-wasm tests share. Every credential here is a
//! test-only placeholder.

#[cfg(feature = "browser-wasm-tests")]
use nook_core::AuthProvidersSnapshot;
use nook_core::{
    GithubProvider, ProviderSecretText, ProviderVaultScope, S3Connection, S3ConnectionDraft,
    StorageConnection, StorageProvider, StoredGithubRepository, StoredProvider, ValidationError,
};

/// The one owner of the fixtures the nook-wasm tests share.
pub(crate) struct WasmFixture;

impl WasmFixture {
    /// The secret access key of the S3 test connection.
    pub(crate) const S3_SECRET: &'static str = "TEST-ONLY-device-a-secret-not-real";

    /// A test-only credential text.
    pub(crate) fn secret(text: &str) -> Result<ProviderSecretText, ValidationError> {
        ProviderSecretText::try_from(text.to_owned())
    }

    /// A GitHub connection with a test-only token.
    pub(crate) fn github_connection(
        token: &str,
        repo: &str,
    ) -> Result<StorageConnection, ValidationError> {
        Ok(StorageConnection::Github {
            token: Self::secret(token)?,
            repo: repo.to_owned(),
        })
    }

    /// A never-synced GitHub row with a test-only token.
    pub(crate) fn github_row(
        id: &str,
        token: &str,
        repository: &str,
    ) -> Result<StorageProvider, ValidationError> {
        Ok(StorageProvider::never_synced(
            id.to_owned(),
            ProviderVaultScope::Unscoped,
            "2026-01-01T00:00:00Z".to_owned(),
            StoredProvider::Github(GithubProvider {
                repository: StoredGithubRepository::Repository(repository.to_owned()),
                token: Self::secret(token)?,
            }),
        ))
    }

    /// The token of a snapshot whose first row is a GitHub row.
    #[cfg(feature = "browser-wasm-tests")]
    pub(crate) fn first_github_token(
        snapshot: &AuthProvidersSnapshot,
    ) -> anyhow::Result<&ProviderSecretText> {
        let [row, ..] = snapshot.providers.as_slice() else {
            anyhow::bail!("the snapshot should hold a row");
        };
        let StoredProvider::Github(github) = &row.provider else {
            anyhow::bail!("the first row should be a GitHub row");
        };
        Ok(&github.token)
    }

    /// The S3 setup form the tests fill in for the local development server.
    pub(crate) fn s3_draft() -> S3ConnectionDraft {
        S3ConnectionDraft {
            endpoint: "http://127.0.0.1:8333".to_owned(),
            region: "us-east-1".to_owned(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "e2e".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: Self::S3_SECRET.to_owned(),
        }
    }

    /// The validated S3 connection the tests reach the local development
    /// server with.
    pub(crate) fn s3_connection() -> Result<S3Connection, ValidationError> {
        S3Connection::try_from(Self::s3_draft())
    }
}
