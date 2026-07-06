//! Construct signed vault events from session state.

use crate::errors::{EventError, VaultResult};
use crate::event_canonical::EventId;
use crate::vault_event::{
    EncryptedSecretPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
    serialize_event_storage_yaml,
};
use crate::vault_ids::{AuthKeyId, SecretId, StoreId};
use crate::vault_signing::SigningIdentity;
use crate::vault_wire::{IsoTimestamp, OpaqueCiphertext};

/// Inputs required to append a new event.
pub struct AppendEventInput<'a> {
    pub store_id: &'a StoreId,
    pub actor_id: &'a AuthKeyId,
    pub signing_identity: &'a SigningIdentity,
    pub parents: Vec<EventId>,
    pub key_epoch: &'a EventId,
    pub created_at: &'a IsoTimestamp,
    pub operations: Vec<VaultOperation>,
}

/// Build and sign a vault event; returns the event and its provider-storage YAML bytes.
pub fn build_signed_event(input: AppendEventInput<'_>) -> VaultResult<(VaultEvent, Vec<u8>)> {
    let signing_actor_id = input.signing_identity.actor_id()?;
    if signing_actor_id != *input.actor_id {
        return Err(EventError::ActorSigningKeyMismatch {
            actor_id: input.actor_id.as_str().to_owned(),
            signing_key_actor_id: signing_actor_id.as_str().to_owned(),
        }
        .into());
    }
    let mut parents = input.parents;
    parents.sort();
    parents.dedup();

    let body = VaultEventBody {
        schema_version: VaultEventSchemaVersion::CURRENT,
        store_id: input.store_id.clone(),
        actor_id: input.actor_id.clone(),
        actor_signing_public_key: Some(input.signing_identity.public_key()),
        parents,
        created_at: input.created_at.clone(),
        key_epoch: input.key_epoch.clone(),
        operations: input.operations,
    };
    let event = VaultEvent::sign(body, input.signing_identity.signing_key())?;
    let bytes = serialize_event_storage_yaml(&event)?;
    Ok((event, bytes))
}

#[must_use]
pub fn encrypted_secret_from_armored(
    id: &SecretId,
    secret_type: crate::SecretType,
    ciphertext: &str,
) -> EncryptedSecretPayload {
    EncryptedSecretPayload {
        id: id.clone(),
        secret_type,
        ciphertext: OpaqueCiphertext::from_trusted(ciphertext.to_owned()),
    }
}

/// Parent list from current causal heads.
#[must_use]
pub fn parents_from_heads(heads: &[EventId]) -> Vec<EventId> {
    let mut parents = heads.to_vec();
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
    pub fn as_parents(&self) -> Vec<EventId> {
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
    use crate::event_canonical::EventId;
    use crate::vault_signing::SigningIdentity;
    use crate::{VaultResult, parse_event_storage_bytes};

    #[test]
    fn parents_from_heads_is_sorted_deduped() -> VaultResult<()> {
        let a = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let b = EventId::parse("sha256u:u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s")?;
        let parents = parents_from_heads(&[b.clone(), a.clone(), a]);
        assert_eq!(parents.len(), 2);
        assert!(parents[0] < parents[1]);
        Ok(())
    }

    #[test]
    fn build_signed_event_roundtrip() -> VaultResult<()> {
        let (signing, _) = SigningIdentity::generate()?;
        let actor = signing.actor_id()?;
        let store_id = StoreId::parse("store_testtoken11")?;
        let epoch = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let created_at = IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned());
        let (event, bytes) = build_signed_event(AppendEventInput {
            store_id: &store_id,
            actor_id: &actor,
            signing_identity: &signing,
            parents: vec![],
            key_epoch: &epoch,
            created_at: &created_at,
            operations: vec![VaultOperation::VaultCleared],
        })?;
        assert!(!bytes.is_empty());
        assert!(
            std::str::from_utf8(&bytes)
                .expect("event YAML is UTF-8")
                .starts_with("schema_version:")
        );
        assert_eq!(event.body.store_id, store_id);
        assert_eq!(event.body.actor_id, actor);
        assert_eq!(parse_event_storage_bytes(&bytes)?.id()?, event.id()?);
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
        let a = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let b = EventId::parse("sha256u:u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s")?;
        let heads = ObservedHeads::parse(&[
            b.as_str().to_owned(),
            a.as_str().to_owned(),
            a.as_str().to_owned(),
        ])?;
        assert_eq!(heads.as_event_ids().len(), 2);
        assert_eq!(heads.as_parents(), parents_from_heads(heads.as_event_ids()));
        Ok(())
    }
}
