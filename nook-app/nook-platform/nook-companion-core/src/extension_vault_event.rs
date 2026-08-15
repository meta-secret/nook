//! Complete encrypted vault-event ingress for browser-extension sessions.

use serde::Deserialize;
use tsify::Tsify;
pub const EXTENSION_VAULT_EVENT_TYPESCRIPT: &str = r#"
export type ExtensionVaultEventPayload = {
    schema_version: number;
    store_id: string;
    actor_id: string;
    actor_signing_public_key: string;
    parents: string[];
    created_at: string;
    key_epoch: string;
    operations: (
        | { type: "vault-imported"; source_content_hash: string; secrets: { id: string; type: "login" | "api-key" | "seed-phrase" | "secure-note" | "passkey" | "authenticator" | "credit-card" | "file-attachment"; ciphertext: string; identity_fingerprint: string; fingerprint: string }[]; password_entries: { id: string; label: string; created_at: string; envelope: { version: number; kdf: string; work_factor: number; recipient?: string; wrapped_keys?: string; ciphertext: string } }[] }
        | { type: "secret-created"; secret: { id: string; type: "login" | "api-key" | "seed-phrase" | "secure-note" | "passkey" | "authenticator" | "credit-card" | "file-attachment"; ciphertext: string; identity_fingerprint: string; fingerprint: string } }
        | { type: "secret-deleted"; secret_id: string }
        | { type: "secret-replaced"; old_id: string; new_secret: { id: string; type: "login" | "api-key" | "seed-phrase" | "secure-note" | "passkey" | "authenticator" | "credit-card" | "file-attachment"; ciphertext: string; identity_fingerprint: string; fingerprint: string } }
        | { type: "secret-conflict-resolved"; old_id: string; chosen_secret_id: string; rejected_secret_ids: string[] }
        | { type: "join-requested"; device_id: string; encryption_public_key: string; signing_public_key: string; label: string }
        | { type: "join-approved"; device_id: string; encryption_public_key: string; signing_public_key: string; label: string; secrets_key_ciphertext: string; members_key_ciphertext: string }
        | { type: "sentinel-participant-enrolled"; device_id: string; encryption_public_key: string; signing_public_key: string; label: string }
        | { type: "sentinel-shares-issued"; shares: { device_id: string; version: number; threshold: number; required_participants: number; share_index: number; ciphertext: string }[] }
        | { type: "join-denied"; device_id: string }
        | { type: "member-renamed"; device_id: string; label: string }
        | { type: "device-revoked"; device_id: string }
        | { type: "password-added"; entry_id: string; label: string; created_at: string; envelope: { version: number; kdf: string; work_factor: number; recipient?: string; wrapped_keys?: string; ciphertext: string } }
        | { type: "password-rotated"; entry_id: string; envelope: { version: number; kdf: string; work_factor: number; recipient?: string; wrapped_keys?: string; ciphertext: string } }
        | { type: "password-envelope-upgraded"; entry_id: string; envelope: { version: number; kdf: string; work_factor: number; recipient?: string; wrapped_keys?: string; ciphertext: string } }
        | { type: "password-removed"; entry_id: string }
        | { type: "vault-cleared" }
        | { type: "epoch-checkpoint"; secrets: { id: string; type: "login" | "api-key" | "seed-phrase" | "secure-note" | "passkey" | "authenticator" | "credit-card" | "file-attachment"; ciphertext: string; identity_fingerprint: string; fingerprint: string }[]; members_checkpoint_hash: string; rotated_meta_records?: { id: string; type?: "login" | "api-key" | "seed-phrase" | "secure-note" | "passkey" | "authenticator" | "credit-card" | "file-attachment"; data: string }[]; password_entries?: { id: string; label: string; created_at: string; envelope: { version: number; kdf: string; work_factor: number; recipient?: string; wrapped_keys?: string; ciphertext: string } }[] }
    )[];
    signature: string;
};
"#;

/// A complete encrypted vault event crossing the extension session boundary.
///
/// Rust deserializes the existing event-log domain type. The TypeScript shape
/// is exhaustive so browser glue can carry the domain value without a generic
/// object or value bag.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "ExtensionVaultEventPayload")]
pub struct ExtensionVaultEventPayload(nook_event_log::VaultEvent);

#[cfg(test)]
mod tests {
    use super::EXTENSION_VAULT_EVENT_TYPESCRIPT;

    #[test]
    fn typescript_contract_covers_schema_v3() {
        for token in [
            "password-envelope-upgraded",
            "wrapped_keys?",
            "rotated_meta_records?",
            "password_entries?",
        ] {
            assert!(EXTENSION_VAULT_EVENT_TYPESCRIPT.contains(token));
        }
    }
}
