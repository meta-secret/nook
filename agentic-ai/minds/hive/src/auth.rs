use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, anyhow};
use codex::{
    AuthCredentialsStoreMode, AuthKeyringBackendKind, AuthManager, CodexAuth, ExternalAuth,
    ExternalAuthFuture, ExternalAuthRefreshContext,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;

const AUTH_CONNECT_ATTEMPTS: usize = 120;
const AUTH_CONNECT_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, Deserialize, Serialize)]
struct BrokerRequest {
    refresh: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct BrokerResponse {
    access_token: String,
    account_id: String,
}

pub struct BrokerExternalAuth {
    channel: Mutex<BufReader<UnixStream>>,
}

impl BrokerExternalAuth {
    pub async fn connect(socket_path: &Path) -> anyhow::Result<Arc<Self>> {
        for attempt in 0..AUTH_CONNECT_ATTEMPTS {
            match UnixStream::connect(socket_path).await {
                Ok(stream) => {
                    return Ok(Arc::new(Self {
                        channel: Mutex::new(BufReader::new(stream)),
                    }));
                }
                Err(_) if attempt + 1 < AUTH_CONNECT_ATTEMPTS => {
                    tokio::time::sleep(AUTH_CONNECT_DELAY).await;
                }
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!(
                            "failed to connect to the Hive auth broker at {}",
                            socket_path.display()
                        )
                    });
                }
            }
        }
        unreachable!("bounded auth broker connection loop always returns")
    }

    async fn request(&self, refresh: bool) -> std::io::Result<CodexAuth> {
        let mut channel = self.channel.lock().await;
        let request =
            serde_json::to_vec(&BrokerRequest { refresh }).map_err(std::io::Error::other)?;
        channel.get_mut().write_all(&request).await?;
        channel.get_mut().write_all(b"\n").await?;
        channel.get_mut().flush().await?;

        let mut response = String::new();
        if channel.read_line(&mut response).await? == 0 {
            return Err(std::io::Error::other(
                "Hive auth broker closed the private channel",
            ));
        }
        let response: BrokerResponse =
            serde_json::from_str(&response).map_err(std::io::Error::other)?;
        CodexAuth::from_external_chatgpt_tokens(&response.access_token, &response.account_id, None)
    }
}

impl ExternalAuth for BrokerExternalAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(self.request(false))
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(self.request(true))
    }
}

pub async fn run_auth_broker(
    socket_path: PathBuf,
    auth_source: PathBuf,
    auth_home: PathBuf,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(&auth_home).await?;
    let private_auth = auth_home.join("auth.json");
    tokio::fs::copy(&auth_source, &private_auth)
        .await
        .context("failed to stage Codex authentication inside the broker container")?;
    let mut permissions = tokio::fs::metadata(&private_auth).await?.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o600);
    }
    tokio::fs::set_permissions(&private_auth, permissions).await?;

    let auth_manager = AuthManager::shared(
        auth_home,
        false,
        AuthCredentialsStoreMode::File,
        None,
        None,
        AuthKeyringBackendKind::default(),
        None,
    )
    .await;
    if auth_manager.auth_cached().is_none() {
        return Err(anyhow!("Codex authentication is unavailable to the broker"));
    }

    if let Some(parent) = socket_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match tokio::fs::remove_file(&socket_path).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let listener = UnixListener::bind(&socket_path)?;
    let (stream, _) = listener.accept().await?;
    drop(listener);
    tokio::fs::remove_file(&socket_path)
        .await
        .context("failed to unlink the accepted auth broker socket")?;

    let mut channel = BufReader::new(stream);
    loop {
        let mut request = String::new();
        if channel.read_line(&mut request).await? == 0 {
            return Ok(());
        }
        let request: BrokerRequest =
            serde_json::from_str(&request).context("invalid auth broker request")?;
        if request.refresh {
            auth_manager
                .refresh_token_from_authority()
                .await
                .map_err(|error| anyhow!("Codex authentication refresh failed: {error}"))?;
        }
        let auth = auth_manager
            .auth_cached()
            .ok_or_else(|| anyhow!("Codex authentication disappeared from the broker"))?;
        let response = BrokerResponse {
            access_token: auth.get_token()?,
            account_id: auth
                .get_account_id()
                .ok_or_else(|| anyhow!("Codex authentication has no account id"))?,
        };
        let response = serde_json::to_vec(&response)?;
        channel.get_mut().write_all(&response).await?;
        channel.get_mut().write_all(b"\n").await?;
        channel.get_mut().flush().await?;
    }
}

#[cfg(test)]
mod tests {
    use super::{BrokerRequest, BrokerResponse};

    #[test]
    fn broker_protocol_does_not_serialize_refresh_tokens() {
        let response = BrokerResponse {
            access_token: "access".to_owned(),
            account_id: "account".to_owned(),
        };
        let encoded = serde_json::to_string(&response).unwrap();

        assert!(!encoded.contains("refresh_token"));
        assert!(
            serde_json::from_str::<BrokerRequest>(r#"{"refresh":true}"#)
                .unwrap()
                .refresh
        );
    }
}
