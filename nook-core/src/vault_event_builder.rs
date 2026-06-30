//! Construct signed vault events from session state.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::EventId;
use crate::vault_event::{
    EncryptedSecretPayload, VAULT_EVENT_SCHEMA_VERSION, VaultEvent, VaultEventBody, VaultOperation,
};
use crate::vault_signing::SigningIdentity;

/// Inputs required to append a new event.
pub struct AppendEventInput<'a> {
    pub store_id: &'a str,
    pub actor_id: &'a str,
    pub signing_identity: &'a SigningIdentity,
    pub parents: Vec<String>,
    pub key_epoch: &'a str,
    pub created_at: &'a str,
    pub operations: Vec<VaultOperation>,
}

/// Build and sign a vault event; returns the event and its canonical JSON bytes.
pub fn build_signed_event(input: AppendEventInput<'_>) -> VaultResult<(VaultEvent, Vec<u8>)> {
    input.signing_identity.actor_id()?;
    let mut parents = input.parents;
    parents.sort();
    parents.dedup();

    let body = VaultEventBody {
        schema_version: VAULT_EVENT_SCHEMA_VERSION,
        store_id: input.store_id.to_owned(),
        actor_id: input.actor_id.to_owned(),
        parents,
        created_at: input.created_at.to_owned(),
        key_epoch: input.key_epoch.to_owned(),
        operations: input.operations,
    };
    let event = VaultEvent::sign(body, input.signing_identity.signing_key())?;
    let bytes = serde_json::to_vec(&event).map_err(EventError::from)?;
    Ok((event, bytes))
}

#[must_use]
pub fn encrypted_secret_from_armored(
    id: &str,
    secret_type: crate::SecretType,
    ciphertext: &str,
) -> EncryptedSecretPayload {
    EncryptedSecretPayload {
        id: id.to_owned(),
        secret_type,
        ciphertext: ciphertext.to_owned(),
    }
}

/// Parent list from current causal heads.
#[must_use]
pub fn parents_from_heads(heads: &[EventId]) -> Vec<String> {
    let mut parents: Vec<String> = heads.iter().map(|id| id.as_str().to_owned()).collect();
    parents.sort();
    parents.dedup();
    parents
}

/// Validated causal head set observed locally before appending a new event.
///
/// Construct via [`ObservedHeads::parse`] so parent ids are well-formed before signing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedHeads(Vec<EventId>);

impl ObservedHeads {
    /// Parse and deduplicate raw head strings from session state.
    pub fn parse(raw: &[String]) -> VaultResult<Self> {
        let mut ids: Vec<EventId> = raw
            .iter()
            .map(|s| EventId::parse(s))
            .collect::<Result<_, _>>()?;
        ids.sort();
        ids.dedup();
        Ok(Self(ids))
    }

    #[must_use]
    pub fn as_event_ids(&self) -> &[EventId] {
        &self.0
    }

    #[must_use]
    pub fn as_parent_strings(&self) -> Vec<String> {
        parents_from_heads(&self.0)
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultResult;
    use crate::event_canonical::EventId;
    use crate::vault_signing::SigningIdentity;

    #[test]
    fn parents_from_heads_is_sorted_deduped() -> VaultResult<()> {
        let a = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )?;
        let b = EventId::parse(
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        )?;
        let parents = parents_from_heads(&[b.clone(), a.clone(), a]);
        assert_eq!(parents.len(), 2);
        assert!(parents[0] < parents[1]);
        Ok(())
    }

    #[test]
    fn build_signed_event_roundtrip() -> VaultResult<()> {
        let (signing, _) = SigningIdentity::generate()?;
        let actor = signing.actor_id()?;
        let epoch = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: "store_testtoken1",
            actor_id: &actor,
            signing_identity: &signing,
            parents: vec![],
            key_epoch: epoch,
            created_at: "2026-06-28T00:00:00Z",
            operations: vec![VaultOperation::VaultCleared],
        })?;
        assert!(!bytes.is_empty());
        assert_eq!(event.body.store_id, "store_testtoken1");
        assert_eq!(event.body.actor_id, actor);
        Ok(())
    }

    #[test]
    fn observed_heads_rejects_invalid_parent_id() {
        let err = ObservedHeads::parse(&["not-an-event-id".to_owned()]).unwrap_err();
        assert!(matches!(
            err,
            crate::VaultError::Event(crate::EventError::EventIdMissingPrefix { .. })
        ));
    }

    #[test]
    fn observed_heads_deduplicates_sorted() -> VaultResult<()> {
        let a = EventId::parse(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )?;
        let b = EventId::parse(
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        )?;
        let heads = ObservedHeads::parse(&[
            b.as_str().to_owned(),
            a.as_str().to_owned(),
            a.as_str().to_owned(),
        ])?;
        assert_eq!(heads.as_event_ids().len(), 2);
        assert_eq!(
            heads.as_parent_strings(),
            parents_from_heads(heads.as_event_ids())
        );
        Ok(())
    }
}
