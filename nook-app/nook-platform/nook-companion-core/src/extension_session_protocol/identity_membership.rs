//! Session requests through which the browser extension is an app of its
//! keyrings: the web app adds it with its own key and hands it the keyring's
//! log and each vault's records; it joins from that log, opens the vaults,
//! pairs vaults created later, and connects further keyrings, each with its
//! own app key.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use super::queue::QueueDisposition;
use super::request::ExtensionEventLogRecord;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Join the keyring the web app just added this app to, from the keyring's
/// control log it handed over. The log is signed, not secret; no
/// credential travels in this request.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JoinIdentityPayload {
    identity_id: String,
    member_label: String,
    identity_events: Vec<String>,
    queue: QueueDisposition,
}

/// Where one vault of the keyring is read from when the extension opens it.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum IdentityVaultSource {
    /// The records the web app handed over when it added the extension.
    #[serde(rename_all = "camelCase")]
    Records {
        event_log_records: Vec<ExtensionEventLogRecord>,
    },
    /// A sync provider the session already holds, by id, so no credential
    /// travels in this request: vaults created later arrive this way.
    #[serde(rename_all = "camelCase")]
    Mount { mount_provider_id: String },
}

/// Open one vault of the joined keyring with the key the keyring grants
/// this app.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectIdentityVaultPayload {
    vault_store_id: String,
    source: IdentityVaultSource,
    queue: QueueDisposition,
}

/// Bring the unlocked identity's log up to date from its sync providers and
/// list the vaults the extension does not pair yet. The extension names the
/// vaults it pairs; no credential travels in this request.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RefreshIdentityVaultsPayload {
    paired_vault_store_ids: Vec<String>,
    queue: QueueDisposition,
}

/// Start connecting one more identity; `label` names the new local identity
/// when the next identity needs its own app key.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BeginIdentityConnectionPayload {
    label: String,
    queue: QueueDisposition,
}

/// Use another identity of this extension: select the local identity that
/// owns the app key and lock the current one until it is unlocked.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ActivateIdentityPayload {
    app_id: String,
    queue: QueueDisposition,
}

#[cfg(test)]
mod tests {
    use super::super::request::{ExtensionSessionRequest, ExtensionSessionRequestValidation};

    const JOIN_IDENTITY: &str = r#"{"type":"nook:extension-session-join-identity","payload":{"identityId":"identity-1","memberLabel":"Nook Extension","identityEvents":["event-1"],"queue":{"kind":"message-default"}}}"#;

    fn validated(request: &str) -> ExtensionSessionRequestValidation {
        ExtensionSessionRequestValidation::validate_extension_session_request_json(request)
    }

    #[test]
    fn joining_a_keyring_carries_its_log_and_no_credential() -> anyhow::Result<()> {
        assert_eq!(
            validated(JOIN_IDENTITY),
            ExtensionSessionRequestValidation::Accepted
        );
        let request: ExtensionSessionRequest = serde_json::from_str(JOIN_IDENTITY)?;
        assert!(matches!(request, ExtensionSessionRequest::JoinIdentity(_)));
        let with_token = JOIN_IDENTITY.replace(
            r#""identityEvents":["event-1"],"#,
            r#""identityEvents":["event-1"],"githubPat":"ghp_secret","#,
        );
        assert_eq!(
            validated(&with_token),
            ExtensionSessionRequestValidation::Rejected
        );
        Ok(())
    }

    #[test]
    fn a_keyring_vault_opens_from_handed_over_records_or_a_mount() {
        let from_records = r#"{"type":"nook:extension-session-connect-identity-vault","payload":{"vaultStoreId":"store_abcdefghijk","source":{"kind":"records","eventLogRecords":[]},"queue":{"kind":"message-default"}}}"#;
        let from_mount = r#"{"type":"nook:extension-session-connect-identity-vault","payload":{"vaultStoreId":"store_abcdefghijk","source":{"kind":"mount","mountProviderId":"provider-1"},"queue":{"kind":"message-default"}}}"#;
        for request in [from_records, from_mount] {
            assert_eq!(
                validated(request),
                ExtensionSessionRequestValidation::Accepted
            );
        }
        // A mount carries its id only, never a credential.
        let with_token = from_mount.replace(
            r#""mountProviderId":"provider-1""#,
            r#""mountProviderId":"provider-1","githubPat":"ghp_secret""#,
        );
        assert_eq!(
            validated(&with_token),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn refreshing_identity_vaults_names_paired_vaults_and_no_credential() {
        let request = r#"{"type":"nook:extension-session-refresh-identity-vaults","payload":{"pairedVaultStoreIds":["store_abcdefghijk"],"queue":{"kind":"message-default"}}}"#;
        assert_eq!(
            validated(request),
            ExtensionSessionRequestValidation::Accepted
        );
        let with_provider = request.replace(
            r#""pairedVaultStoreIds""#,
            r#""providers":[],"pairedVaultStoreIds""#,
        );
        assert_eq!(
            validated(&with_provider),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn connecting_another_identity_carries_its_name() {
        let begin = r#"{"type":"nook:extension-session-begin-identity-connection","payload":{"label":"Work","queue":{"kind":"message-default"}}}"#;
        let cancel = r#"{"type":"nook:extension-session-cancel-identity-connection","payload":{"queue":{"kind":"message-default"}}}"#;
        let activate = r#"{"type":"nook:extension-session-activate-identity","payload":{"appId":"app-1","queue":{"kind":"message-default"}}}"#;
        for request in [begin, cancel, activate] {
            assert_eq!(
                validated(request),
                ExtensionSessionRequestValidation::Accepted
            );
        }
        assert_eq!(
            validated(&begin.replace(r#""label":"Work","#, "")),
            ExtensionSessionRequestValidation::Rejected
        );
    }
}
