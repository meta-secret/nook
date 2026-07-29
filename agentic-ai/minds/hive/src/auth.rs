use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use crate::HiveContext;
use codex::{
    AuthCredentialsStoreMode, AuthKeyringBackendKind, AuthManager, CodexAuth, ExternalAuth,
    ExternalAuthFuture, ExternalAuthRefreshContext,
};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::process::Command;
use tokio::sync::Mutex;

const AUTH_CONNECT_ATTEMPTS: usize = 120;
const AUTH_CONNECT_DELAY: Duration = Duration::from_millis(500);
const AUTH_PERSIST_URL_ENV: &str = "HIVE_AUTH_PERSIST_URL";
const AUTH_API_TOKEN: &str = "/run/secrets/hive-auth-api/token";
const AUTH_API_CA: &str = "/run/secrets/hive-auth-api/ca.crt";
const AUTH_PERSIST_RETRY_MAX: Duration = Duration::from_secs(30);

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
    pub async fn connect(socket_path: &Path) -> crate::HiveResult<Arc<Self>> {
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
                    return Err(error).with_hive_context(|| {
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

    pub async fn validate(&self) -> std::io::Result<()> {
        self.request(false).await.map(drop)
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
) -> crate::HiveResult<()> {
    tokio::fs::create_dir_all(&auth_home).await?;
    let private_auth = auth_home.join("auth.json");
    tokio::fs::copy(&auth_source, &private_auth)
        .await
        .hive_context("failed to stage Codex authentication inside the broker container")?;
    let mut permissions = tokio::fs::metadata(&private_auth).await?.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o600);
    }
    tokio::fs::set_permissions(&private_auth, permissions).await?;

    let mut auth_manager = AuthManager::shared(
        auth_home.clone(),
        false,
        AuthCredentialsStoreMode::File,
        None,
        None,
        AuthKeyringBackendKind::default(),
        None,
    )
    .await;
    if auth_manager.auth_cached().is_none() {
        return Err(crate::hive_error!(
            "Codex authentication is unavailable to the broker"
        ));
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
        .hive_context("failed to unlink the accepted auth broker socket")?;

    let mut channel = BufReader::new(stream);
    loop {
        let mut request = String::new();
        if channel.read_line(&mut request).await? == 0 {
            return Ok(());
        }
        let request: BrokerRequest =
            serde_json::from_str(&request).hive_context("invalid auth broker request")?;
        if request.refresh {
            let projected_auth = tokio::fs::read(&auth_source)
                .await
                .hive_context("failed to reload projected Codex authentication")?;
            let private_auth_bytes = tokio::fs::read(&private_auth).await?;
            if projected_auth != private_auth_bytes {
                tokio::fs::write(&private_auth, projected_auth).await?;
                auth_manager = AuthManager::shared(
                    auth_home.clone(),
                    false,
                    AuthCredentialsStoreMode::File,
                    None,
                    None,
                    AuthKeyringBackendKind::default(),
                    None,
                )
                .await;
            } else {
                match auth_manager.refresh_token_from_authority().await {
                    Ok(()) => persist_rotated_auth(&private_auth, &auth_home).await,
                    Err(refresh_error) => {
                        // Another warm broker may have won a rotating refresh-token race.
                        // Wait for its Secret update to reach this projected volume and retry
                        // from the durable replacement instead of failing the active task.
                        let mut replacement = None;
                        for _ in 0..AUTH_CONNECT_ATTEMPTS {
                            tokio::time::sleep(AUTH_CONNECT_DELAY).await;
                            let candidate = tokio::fs::read(&auth_source)
                                .await
                                .hive_context("failed to reload projected Codex authentication")?;
                            if candidate != private_auth_bytes {
                                replacement = Some(candidate);
                                break;
                            }
                        }
                        let replacement = replacement.ok_or_else(|| {
                            crate::hive_error!(
                                "Codex authentication refresh failed: {refresh_error}"
                            )
                        })?;
                        tokio::fs::write(&private_auth, replacement).await?;
                        auth_manager = AuthManager::shared(
                            auth_home.clone(),
                            false,
                            AuthCredentialsStoreMode::File,
                            None,
                            None,
                            AuthKeyringBackendKind::default(),
                            None,
                        )
                        .await;
                    }
                }
            }
        }
        let auth = auth_manager.auth_cached().ok_or_else(|| {
            crate::hive_error!("Codex authentication disappeared from the broker")
        })?;
        let response = BrokerResponse {
            access_token: auth.get_token()?,
            account_id: auth
                .get_account_id()
                .ok_or_else(|| crate::hive_error!("Codex authentication has no account id"))?,
        };
        let response = serde_json::to_vec(&response)?;
        channel.get_mut().write_all(&response).await?;
        channel.get_mut().write_all(b"\n").await?;
        channel.get_mut().flush().await?;
    }
}

async fn persist_rotated_auth(private_auth: &Path, auth_home: &Path) {
    let mut delay = Duration::from_secs(1);
    loop {
        match persist_rotated_auth_once(private_auth, auth_home).await {
            Ok(()) => return,
            Err(error) => {
                eprintln!(
                    "Hive auth broker is retaining rotated credentials until Kubernetes persistence succeeds: {error:#}"
                );
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(AUTH_PERSIST_RETRY_MAX);
            }
        }
    }
}

async fn persist_rotated_auth_once(private_auth: &Path, auth_home: &Path) -> crate::HiveResult<()> {
    let url = std::env::var(AUTH_PERSIST_URL_ENV)
        .hive_context("HIVE_AUTH_PERSIST_URL is required to persist rotated credentials")?;
    let token = tokio::fs::read_to_string(AUTH_API_TOKEN)
        .await
        .hive_context("failed to read the broker-only Kubernetes API token")?;
    let auth = tokio::fs::read_to_string(private_auth)
        .await
        .hive_context("failed to read rotated broker credentials")?;
    serde_json::from_str::<serde_json::Value>(&auth)
        .hive_context("rotated broker credentials are not valid JSON")?;
    let patch = serde_json::json!({ "stringData": { "auth.json": auth } });
    let patch_path = auth_home.join("secret-patch.json");
    let header_path = auth_home.join("kubernetes-auth-header");
    tokio::fs::write(&patch_path, serde_json::to_vec(&patch)?).await?;
    tokio::fs::write(
        &header_path,
        format!("Authorization: Bearer {}", token.trim()),
    )
    .await?;
    for path in [&patch_path, &header_path] {
        let mut permissions = tokio::fs::metadata(path).await?.permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            permissions.set_mode(0o600);
        }
        tokio::fs::set_permissions(path, permissions).await?;
    }
    let status = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--request",
            "PATCH",
            "--cacert",
            AUTH_API_CA,
            "--header",
            &format!("@{}", header_path.display()),
            "--header",
            "Content-Type: application/merge-patch+json",
            "--data-binary",
            &format!("@{}", patch_path.display()),
            "--output",
            "/dev/null",
            &url,
        ])
        .stdin(Stdio::null())
        .status()
        .await;
    let _ = tokio::fs::remove_file(&patch_path).await;
    let _ = tokio::fs::remove_file(&header_path).await;
    let status =
        status.hive_context("failed to start the Kubernetes credential persistence request")?;
    if !status.success() {
        return Err(crate::hive_error!(
            "Kubernetes rejected rotated credential persistence with status {status}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{BrokerRequest, BrokerResponse};

    #[test]
    fn broker_protocol_does_not_serialize_refresh_tokens() -> crate::HiveResult<()> {
        let response = BrokerResponse {
            access_token: "access".to_owned(),
            account_id: "account".to_owned(),
        };
        let encoded = serde_json::to_string(&response)?;

        assert!(!encoded.contains("refresh_token"));
        assert!(serde_json::from_str::<BrokerRequest>(r#"{"refresh":true}"#)?.refresh);
        Ok(())
    }
}
