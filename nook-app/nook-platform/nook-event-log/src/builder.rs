//! Construct signed vault events from session state.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::canonical::EventId;
use crate::event::{VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation};
use crate::signing::SigningIdentity;
use crate::{EventError, EventResult, EventStorageBytes};
use nook_auth2::{AuthKeyId, IsoTimestamp, StoreId};

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

impl AppendEventInput<'_> {
    /// Build and sign a vault event; returns the event and its provider-storage YAML bytes.
    pub fn build(self) -> EventResult<(VaultEvent, EventStorageBytes)> {
        let signing_actor_id = self.signing_identity.actor_id()?;
        if signing_actor_id != *self.actor_id {
            return Err(EventError::ActorSigningKeyMismatch {
                actor_id: self.actor_id.as_str().to_owned(),
                signing_key_actor_id: signing_actor_id.as_str().to_owned(),
            });
        }
        let mut parents = self.parents;
        parents.sort();
        parents.dedup();

        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: self.store_id.clone(),
            actor_id: self.actor_id.clone(),
            actor_signing_public_key: self.signing_identity.public_key(),
            parents,
            created_at: self.created_at.clone(),
            key_epoch: self.key_epoch.clone(),
            operations: self.operations,
        };
        let event = VaultEvent::sign(body, self.signing_identity.signing_key())?;
        let bytes = VaultEvent::serialize_event_storage_yaml(&event)?;
        Ok((event, bytes))
    }
}

/// Validated causal head set observed locally before appending a new event.
///
/// Construct via [`ObservedHeads::parse`] so parent ids are well-formed before signing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedHeads(Vec<EventId>);

impl ObservedHeads {
    /// Parse and deduplicate raw head strings from session state.
    pub fn parse(raw: &[String]) -> EventResult<Self> {
        let ids: Vec<EventId> = raw
            .iter()
            .map(|s| EventId::parse(s))
            .collect::<Result<_, _>>()?;
        Ok(Self::from_event_ids(&ids))
    }

    #[must_use]
    pub fn as_event_ids(&self) -> &[EventId] {
        &self.0
    }

    #[must_use]
    pub fn as_parents(&self) -> Vec<EventId> {
        self.0.clone()
    }

    /// Build validated heads from already parsed event ids.
    #[must_use]
    pub fn from_event_ids(heads: &[EventId]) -> Self {
        let mut ids = heads.to_vec();
        ids.sort();
        ids.dedup();
        Self(ids)
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use std::str;

    use super::*;
    use crate::EventResult;
    use crate::canonical::EventId;
    use crate::signing::SigningIdentity;

    #[test]
    fn parents_from_heads_is_sorted_deduped() -> EventResult<()> {
        let a = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let b = EventId::parse("sha256u:u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s")?;
        let parents = ObservedHeads::from_event_ids(&[b.clone(), a.clone(), a]).as_parents();
        assert_eq!(parents.len(), 2);
        assert!(parents[0] < parents[1]);
        Ok(())
    }

    #[test]
    fn build_signed_event_roundtrip() -> anyhow::Result<()> {
        let (signing, _) = SigningIdentity::generate()?;
        let actor = signing.actor_id()?;
        let store_id = StoreId::parse("store_testtoken11")?;
        let epoch = EventId::parse("sha256u:zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMw")?;
        let created_at = IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned());
        let (event, bytes) = AppendEventInput {
            store_id: &store_id,
            actor_id: &actor,
            signing_identity: &signing,
            parents: vec![],
            key_epoch: &epoch,
            created_at: &created_at,
            operations: vec![VaultOperation::VaultCleared],
        }
        .build()?;
        assert!(!bytes.as_ref().is_empty());
        assert!(str::from_utf8(bytes.as_ref())?.starts_with("schema_version:"));
        assert_eq!(event.body.store_id, store_id);
        assert_eq!(event.body.actor_id, actor);
        assert_eq!(
            VaultEvent::parse_event_storage_bytes(&bytes)?.id()?,
            event.id()?
        );
        Ok(())
    }

    #[test]
    fn observed_heads_rejects_invalid_parent_id() -> anyhow::Result<()> {
        let err = ObservedHeads::parse(&["not-an-event-id".to_owned()])
            .err()
            .ok_or_else(|| anyhow::anyhow!("builder test should reject invalid input"))?;
        assert!(matches!(
            err,
            crate::EventError::EventIdMissingPrefix { .. }
        ));
        Ok(())
    }

    #[test]
    fn observed_heads_deduplicates_sorted() -> EventResult<()> {
        let a = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let b = EventId::parse("sha256u:u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s")?;
        let heads = ObservedHeads::parse(&[
            b.as_str().to_owned(),
            a.as_str().to_owned(),
            a.as_str().to_owned(),
        ])?;
        assert_eq!(heads.as_event_ids().len(), 2);
        assert_eq!(
            heads.as_parents(),
            ObservedHeads::from_event_ids(heads.as_event_ids()).as_parents()
        );
        Ok(())
    }
}
