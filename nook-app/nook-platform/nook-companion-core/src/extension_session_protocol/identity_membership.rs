//! Session requests through which the browser extension is a member of its
//! identities, as a new phone or computer is: it joins with an approval's
//! invite, opens the identity's vaults, pairs vaults created later, and
//! connects further identities, each with its own app key.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use super::queue::QueueDisposition;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Join the identity of an approved vault, as a new device does: the
/// invite from the approval, through a sync provider the session already
/// holds (by id, so no credential travels in this request).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JoinIdentityPayload {
    identity_id: String,
    member_label: String,
    pub(super) code: String,
    pub(super) sealed_passphrase: String,
    mount_provider_id: String,
    queue: QueueDisposition,
}

/// Open one vault of a joined identity with the key the identity grants
/// this installation, through the identity's sync provider.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectIdentityVaultPayload {
    vault_store_id: String,
    mount_provider_id: String,
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
    use zeroize::Zeroize;

    const JOIN_IDENTITY: &str = r#"{"type":"nook:extension-session-join-identity","payload":{"identityId":"identity-1","memberLabel":"Nook Extension","code":"nook-enroll-code","sealedPassphrase":"age-sealed","mountProviderId":"provider-1","queue":{"kind":"message-default"}}}"#;

    fn validated(request: &str) -> ExtensionSessionRequestValidation {
        ExtensionSessionRequestValidation::validate_extension_session_request_json(request)
    }

    #[test]
    fn joining_an_identity_names_the_mount_and_carries_no_credential() {
        assert_eq!(
            validated(JOIN_IDENTITY),
            ExtensionSessionRequestValidation::Accepted
        );
        let with_token = JOIN_IDENTITY.replace(
            r#""mountProviderId":"provider-1","#,
            r#""mountProviderId":"provider-1","githubPat":"ghp_secret","#,
        );
        assert_eq!(
            validated(&with_token),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn join_identity_payload_zeroizes_the_invite() -> anyhow::Result<()> {
        let mut request: ExtensionSessionRequest = serde_json::from_str(JOIN_IDENTITY)?;
        let ExtensionSessionRequest::JoinIdentity(payload) = &mut request else {
            anyhow::bail!("decoded request must preserve the join identity variant");
        };
        payload.code.zeroize();
        payload.sealed_passphrase.zeroize();
        assert!(payload.code.is_empty());
        assert!(payload.sealed_passphrase.is_empty());
        Ok(())
    }

    #[test]
    fn connecting_an_identity_vault_names_the_vault_and_mount() {
        let request = r#"{"type":"nook:extension-session-connect-identity-vault","payload":{"vaultStoreId":"store_abcdefghijk","mountProviderId":"provider-1","queue":{"kind":"message-default"}}}"#;
        assert_eq!(
            validated(request),
            ExtensionSessionRequestValidation::Accepted
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
