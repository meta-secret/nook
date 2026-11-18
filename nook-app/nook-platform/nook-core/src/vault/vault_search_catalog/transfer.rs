//! Signed admission of existing encrypted catalog buckets across app origins.

use crate::errors::{SessionError, VaultError, VaultResult};
use crate::{
    AgeArmoredCiphertext, CanonicalEventBodyBytes, DeviceId, DeviceSigningPublicKey,
    Ed25519Signature, EpochCheckpoint, EventGraph, EventGraphDeviceAccess,
    EventGraphDeviceAccessRequest, EventId, EventLookup, ObservedHeads,
    SECRET_SEARCH_CATALOG_BUCKET_COUNT, SecretSearchCatalogBucket, SigningIdentity, StoreId,
    VaultCrypto, VaultOperation,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use tsify::Tsify;

#[derive(Clone, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string")]
pub struct EncodedSearchCatalogHint(String);

impl EncodedSearchCatalogHint {
    pub const MAX_BYTES: usize = 4 * 1024 * 1024;
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptedSearchCatalogBucket {
    pub bucket: SecretSearchCatalogBucket,
    pub ciphertext: AgeArmoredCiphertext,
}

#[derive(Clone, Copy)]
pub struct SearchCatalogHintContext<'a> {
    pub store_id: &'a StoreId,
    pub graph: &'a EventGraph,
}

pub struct SearchCatalogHintSignRequest<'a> {
    pub context: SearchCatalogHintContext<'a>,
    pub issuer: &'a DeviceId,
    pub signer: &'a SigningIdentity,
    pub buckets: Vec<EncryptedSearchCatalogBucket>,
}

#[derive(Clone, Copy)]
pub struct SearchCatalogHintAdmitRequest<'a> {
    pub encoded: &'a EncodedSearchCatalogHint,
    pub context: SearchCatalogHintContext<'a>,
}

#[derive(Clone, Copy)]
pub struct PublishedSearchCatalogHintRequest<'a> {
    pub hint: SearchCatalogHintAdmitRequest<'a>,
    pub event_ids: &'a [EventId],
    pub recipient: &'a EventGraphDeviceAccessRequest<'a>,
}

struct SearchCatalogHintVerification<'a> {
    context: SearchCatalogHintContext<'a>,
    heads: ObservedHeads,
    epoch: EpochCheckpoint,
}

#[derive(Serialize, Deserialize)]
enum SearchCatalogHintFormat {
    #[serde(rename = "nook/encrypted-search-catalog-hint/v1")]
    V1,
}

#[derive(PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "checkpoint", rename_all = "kebab-case")]
enum SearchCatalogHintEpoch {
    Unrotated,
    Committed(EventId),
}

impl From<EpochCheckpoint> for SearchCatalogHintEpoch {
    fn from(value: EpochCheckpoint) -> Self {
        match value {
            EpochCheckpoint::Unrotated => Self::Unrotated,
            EpochCheckpoint::Committed(id) => Self::Committed(id),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchCatalogHintBody {
    format: SearchCatalogHintFormat,
    store_id: StoreId,
    heads: Vec<EventId>,
    epoch: SearchCatalogHintEpoch,
    issuer: DeviceId,
    buckets: Vec<EncryptedSearchCatalogBucket>,
}

impl SearchCatalogHintBody {
    fn canonical_bytes(&self) -> VaultResult<CanonicalEventBodyBytes> {
        let body = serde_json::to_value(self)
            .map_err(|_| SessionError::SearchCatalogSerialize("hint body".to_owned()))?;
        Ok(CanonicalEventBodyBytes::from_json(&body)?)
    }

    fn verify_shape(&self) -> VaultResult<()> {
        if self.buckets.is_empty()
            || self
                .buckets
                .iter()
                .any(|value| u8::from(value.bucket) >= SECRET_SEARCH_CATALOG_BUCKET_COUNT)
            || !self
                .buckets
                .is_sorted_by(|left, right| left.bucket < right.bucket)
        {
            return Err(SignedSearchCatalogHint::invalid());
        }
        Ok(())
    }

    fn active_issuer_key(&self, graph: &EventGraph) -> VaultResult<DeviceSigningPublicKey> {
        let member = graph
            .authorized_roster()?
            .members
            .into_iter()
            .find(|member| member.device_id == self.issuer)
            .ok_or_else(SignedSearchCatalogHint::invalid)?;
        if !EventGraphDeviceAccess::new(graph).has_access(&EventGraphDeviceAccessRequest {
            expected_device_id: &member.device_id,
            expected_public_key: &member.encryption_public_key,
            expected_signing_public_key: &member.signing_public_key,
        })? {
            return Err(SignedSearchCatalogHint::invalid());
        }
        Ok(member.signing_public_key)
    }
}

/// Signed advisory data only. It carries no grant or credential authority.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedSearchCatalogHint {
    body: SearchCatalogHintBody,
    signature: Ed25519Signature,
}

impl SignedSearchCatalogHint {
    fn invalid() -> VaultError {
        SessionError::SearchCatalogInvalid("encrypted hint rejected".to_owned()).into()
    }

    pub fn sign(
        request: SearchCatalogHintSignRequest<'_>,
    ) -> VaultResult<EncodedSearchCatalogHint> {
        let SearchCatalogHintSignRequest {
            context,
            issuer,
            signer,
            mut buckets,
        } = request;
        buckets.sort_by_key(|value| value.bucket);
        let body = SearchCatalogHintBody {
            format: SearchCatalogHintFormat::V1,
            store_id: context.store_id.clone(),
            heads: ObservedHeads::from_event_ids(&context.graph.heads()).as_parents(),
            epoch: context.graph.current_epoch_checkpoint()?.into(),
            issuer: issuer.clone(),
            buckets,
        };
        body.verify_shape()?;
        if body.heads.is_empty() || body.active_issuer_key(context.graph)? != signer.public_key() {
            return Err(Self::invalid());
        }
        let bytes = body.canonical_bytes()?;
        if bytes.as_ref().len() > EncodedSearchCatalogHint::MAX_BYTES {
            return Err(Self::invalid());
        }
        let signed = Self {
            body,
            signature: Ed25519Signature::parse(&signer.sign_bytes(&bytes))?,
        };
        let encoded = serde_json::to_string(&signed)
            .map_err(|_| SessionError::SearchCatalogSerialize("signed hint".to_owned()))?;
        if encoded.len() > EncodedSearchCatalogHint::MAX_BYTES {
            return Err(Self::invalid());
        }
        Ok(EncodedSearchCatalogHint(encoded))
    }

    /// Revalidate the exact current authorized graph before using its opaque buckets.
    pub fn admit(
        request: SearchCatalogHintAdmitRequest<'_>,
    ) -> VaultResult<Vec<EncryptedSearchCatalogBucket>> {
        let graph = request.context.graph;
        Self::decode(request.encoded)?.verify(SearchCatalogHintVerification {
            context: request.context,
            heads: ObservedHeads::from_event_ids(&graph.heads()),
            epoch: graph.current_epoch_checkpoint()?,
        })
    }

    /// The complete authenticated shipment must still be current. The receiver
    /// may also retain its separate pairing approval on an incomparable tip.
    pub fn admit_published(
        request: PublishedSearchCatalogHintRequest<'_>,
    ) -> VaultResult<Vec<EncryptedSearchCatalogBucket>> {
        let signed = Self::decode(request.hint.encoded)?;
        let graph = request.hint.context.graph;
        if !EventGraphDeviceAccess::new(graph).has_access(request.recipient)? {
            return Err(Self::invalid());
        }
        let published = request.event_ids.iter().cloned().collect::<BTreeSet<_>>();
        let accepted = graph
            .topological_order()?
            .into_iter()
            .collect::<BTreeSet<_>>();
        if published.is_empty() || !published.is_subset(&accepted) {
            return Err(Self::invalid());
        }
        let mut omitted = accepted.difference(&published);
        if let Some(event_id) = omitted.next() {
            let EventLookup::Recorded(event) = graph.get(event_id) else {
                return Err(Self::invalid());
            };
            let [parent] = event.body.parents.as_slice() else {
                return Err(Self::invalid());
            };
            let [
                VaultOperation::JoinApproved {
                    device_id,
                    encryption_public_key,
                    signing_public_key,
                    ..
                },
            ] = event.body.operations.as_slice()
            else {
                return Err(Self::invalid());
            };
            if omitted.next().is_some()
                || !published.contains(parent)
                || device_id != request.recipient.expected_device_id
                || encryption_public_key != request.recipient.expected_public_key
                || signing_public_key != request.recipient.expected_signing_public_key
            {
                return Err(Self::invalid());
            }
        }
        let mut heads = published.clone();
        for event_id in &published {
            let EventLookup::Recorded(event) = graph.get(event_id) else {
                return Err(Self::invalid());
            };
            for parent in &event.body.parents {
                if !published.contains(parent) {
                    return Err(Self::invalid());
                }
                heads.remove(parent);
            }
        }
        let current_heads = graph.heads().into_iter().collect::<BTreeSet<_>>();
        if !heads.is_subset(&current_heads) {
            return Err(Self::invalid());
        }
        let epoch = graph.current_epoch_checkpoint()?;
        if let EpochCheckpoint::Committed(id) = &epoch
            && !published.contains(id)
        {
            return Err(Self::invalid());
        }
        let heads = heads.into_iter().collect::<Vec<_>>();
        signed.verify(SearchCatalogHintVerification {
            context: request.hint.context,
            heads: ObservedHeads::from_event_ids(&heads),
            epoch,
        })
    }

    fn decode(encoded: &EncodedSearchCatalogHint) -> VaultResult<Self> {
        if encoded.0.len() > EncodedSearchCatalogHint::MAX_BYTES {
            return Err(Self::invalid());
        }
        let signed: Self = serde_json::from_str(&encoded.0).map_err(|_| Self::invalid())?;
        signed.body.verify_shape()?;
        Ok(signed)
    }

    fn verify(
        self,
        request: SearchCatalogHintVerification<'_>,
    ) -> VaultResult<Vec<EncryptedSearchCatalogBucket>> {
        let SearchCatalogHintVerification {
            context,
            heads,
            epoch,
        } = request;
        if heads.is_empty()
            || &self.body.store_id != context.store_id
            || self.body.heads != heads.as_event_ids()
            || self.body.epoch != SearchCatalogHintEpoch::from(epoch)
        {
            return Err(Self::invalid());
        }
        let key = self.body.active_issuer_key(context.graph)?;
        let verifying_key = SigningIdentity::verifying_key_from_public_key_hex(key.as_str())?;
        SigningIdentity::verify_bytes(
            &self.body.canonical_bytes()?,
            self.signature.as_str(),
            &verifying_key,
        )?;
        if !self
            .body
            .buckets
            .iter()
            .all(|bucket| VaultCrypto::is_search_catalog_envelope(&bucket.ciphertext))
        {
            return Err(Self::invalid());
        }
        Ok(self.body.buckets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthEnvelopes, DeviceIdentity, EventGraphInsert, EventGraphRejection, IsoTimestamp,
        MemberLabel, Sha256Hex, VaultCrypto, VaultEvent, VaultEventBody, VaultEventSchemaVersion,
        VaultKeys, VaultOperation,
    };

    struct CatalogPublisher {
        store_id: StoreId,
        identity: DeviceIdentity,
        signing: SigningIdentity,
        keys: VaultKeys,
    }

    struct CatalogPublisherAppend {
        graph: EventGraph,
        operations: Vec<VaultOperation>,
    }

    impl CatalogPublisher {
        fn new() -> anyhow::Result<Self> {
            let (signing, _) = SigningIdentity::generate()?;
            Ok(Self {
                store_id: StoreId::generate()?,
                identity: DeviceIdentity::generate()?,
                signing,
                keys: VaultKeys::generate()?,
            })
        }

        fn append(&self, request: CatalogPublisherAppend) -> anyhow::Result<EventGraph> {
            let CatalogPublisherAppend { graph, operations } = request;
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.store_id.clone(),
                    actor_id: self.signing.actor_id()?,
                    actor_signing_public_key: self.signing.public_key(),
                    parents: graph.heads(),
                    created_at: IsoTimestamp::parse("2026-10-07T00:00:00Z")?,
                    key_epoch: EventId::from_body_bytes(&CanonicalEventBodyBytes::from(
                        b"catalog fixture epoch".to_vec(),
                    )),
                    operations,
                },
                self.signing.signing_key(),
            )?;
            Ok(graph
                .insert(EventGraphInsert {
                    event,
                    expected_store_id: self.store_id.as_str(),
                })
                .map_err(EventGraphRejection::into_cause)?
                .graph)
        }

        fn graph(&self) -> anyhow::Result<EventGraph> {
            let auth = self
                .identity
                .auth_record(&self.keys.secrets_key, &self.keys.members_key)?;
            let envelopes = AuthEnvelopes::parse(auth.value.as_str())?;
            self.append(CatalogPublisherAppend {
                graph: EventGraph::new(),
                operations: vec![
                    VaultOperation::VaultImported {
                        source_content_hash: Sha256Hex::from_bytes(b"catalog fixture"),
                        secrets: Vec::new(),
                    },
                    VaultOperation::JoinApproved {
                        device_id: self.identity.device_id().clone(),
                        encryption_public_key: self.identity.public_key(),
                        signing_public_key: self.signing.public_key(),
                        label: MemberLabel::from_trusted("Owner".to_owned()),
                        secrets_key_ciphertext: envelopes.secrets_key,
                        members_key_ciphertext: envelopes.members_key,
                    },
                ],
            })
        }

        fn context<'a>(&'a self, graph: &'a EventGraph) -> SearchCatalogHintContext<'a> {
            SearchCatalogHintContext {
                store_id: &self.store_id,
                graph,
            }
        }

        fn pairing_approval(&self, recipient: &Self) -> anyhow::Result<VaultOperation> {
            let auth = recipient
                .identity
                .auth_record(&self.keys.secrets_key, &self.keys.members_key)?;
            let envelopes = AuthEnvelopes::parse(auth.value.as_str())?;
            Ok(VaultOperation::JoinApproved {
                device_id: recipient.identity.device_id().clone(),
                encryption_public_key: recipient.identity.public_key(),
                signing_public_key: recipient.signing.public_key(),
                label: MemberLabel::from_trusted("Paired extension".to_owned()),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            })
        }

        fn bucket(&self, id: u8) -> anyhow::Result<EncryptedSearchCatalogBucket> {
            let crypto = VaultCrypto::new(&self.keys.secrets_key)?;
            Ok(EncryptedSearchCatalogBucket {
                bucket: id.into(),
                ciphertext: crypto.encrypt_value("{}")?,
            })
        }

        fn encode(&self, graph: &EventGraph) -> anyhow::Result<EncodedSearchCatalogHint> {
            Ok(SignedSearchCatalogHint::sign(
                SearchCatalogHintSignRequest {
                    context: self.context(graph),
                    issuer: self.identity.device_id(),
                    signer: &self.signing,
                    buckets: vec![self.bucket(19)?, self.bucket(2)?],
                },
            )?)
        }
    }

    #[test]
    fn signed_current_buckets_are_admitted_only_for_the_same_vault_and_frontier()
    -> anyhow::Result<()> {
        let publisher = CatalogPublisher::new()?;
        let graph = publisher.graph()?;
        let encoded = publisher.encode(&graph)?;
        let received = SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
            encoded: &encoded,
            context: publisher.context(&graph),
        })?;
        assert_eq!(
            received
                .iter()
                .map(|entry| u8::from(entry.bucket))
                .collect::<Vec<_>>(),
            [2, 19]
        );
        assert!(!encoded.0.contains("Owner"));
        let foreign_store = StoreId::generate()?;
        assert!(
            SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
                encoded: &encoded,
                context: SearchCatalogHintContext {
                    store_id: &foreign_store,
                    graph: &graph,
                },
            })
            .is_err()
        );
        let advanced = publisher.append(CatalogPublisherAppend {
            graph,
            operations: Vec::new(),
        })?;
        assert!(
            SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
                encoded: &encoded,
                context: publisher.context(&advanced),
            })
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn invalid_publishers_and_modified_ciphertexts_cannot_seed_buckets() -> anyhow::Result<()> {
        let publisher = CatalogPublisher::new()?;
        let graph = publisher.graph()?;
        let (stranger, _) = SigningIdentity::generate()?;
        assert!(
            SignedSearchCatalogHint::sign(SearchCatalogHintSignRequest {
                context: publisher.context(&graph),
                issuer: publisher.identity.device_id(),
                signer: &stranger,
                buckets: vec![publisher.bucket(2)?],
            })
            .is_err()
        );

        let encoded = publisher.encode(&graph)?;
        let mut modified: SignedSearchCatalogHint = serde_json::from_str(&encoded.0)?;
        let first_bucket = modified
            .body
            .buckets
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("signed catalog fixture is empty"))?;
        *first_bucket = publisher.bucket(2)?;
        let modified = EncodedSearchCatalogHint(serde_json::to_string(&modified)?);
        assert!(
            SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
                encoded: &modified,
                context: publisher.context(&graph),
            })
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn repeated_and_out_of_range_bucket_keys_are_rejected() -> anyhow::Result<()> {
        let publisher = CatalogPublisher::new()?;
        let graph = publisher.graph()?;
        for buckets in [
            vec![publisher.bucket(2)?, publisher.bucket(2)?],
            vec![publisher.bucket(SECRET_SEARCH_CATALOG_BUCKET_COUNT)?],
        ] {
            assert!(
                SignedSearchCatalogHint::sign(SearchCatalogHintSignRequest {
                    context: publisher.context(&graph),
                    issuer: publisher.identity.device_id(),
                    signer: &publisher.signing,
                    buckets,
                })
                .is_err()
            );
        }
        Ok(())
    }

    #[test]
    fn current_complete_publication_admits_only_the_recipients_concurrent_pairing_approval()
    -> anyhow::Result<()> {
        let publisher = CatalogPublisher::new()?;
        let recipient = CatalogPublisher::new()?;
        let recipient_key = recipient.identity.public_key();
        let recipient_signer = recipient.signing.public_key();
        let recipient_grant = EventGraphDeviceAccessRequest {
            expected_device_id: recipient.identity.device_id(),
            expected_public_key: &recipient_key,
            expected_signing_public_key: &recipient_signer,
        };
        let root = publisher.graph()?;
        let parent = publisher.append(CatalogPublisherAppend {
            graph: root.clone(),
            operations: Vec::new(),
        })?;
        let source_graph = publisher.append(CatalogPublisherAppend {
            graph: parent,
            operations: vec![publisher.pairing_approval(&recipient)?],
        })?;
        let receipt = publisher.append(CatalogPublisherAppend {
            graph: root.clone(),
            operations: vec![publisher.pairing_approval(&recipient)?],
        })?;
        let union = source_graph.clone().union(&receipt);
        let encoded = publisher.encode(&source_graph)?;
        let shipment_ids = source_graph.topological_order()?;
        let admit = |graph: &EventGraph| {
            SignedSearchCatalogHint::admit_published(PublishedSearchCatalogHintRequest {
                hint: SearchCatalogHintAdmitRequest {
                    encoded: &encoded,
                    context: publisher.context(graph),
                },
                event_ids: &shipment_ids,
                recipient: &recipient_grant,
            })
        };
        assert!(admit(&source_graph).is_ok());
        assert!(admit(&union).is_ok());
        assert!(
            SignedSearchCatalogHint::admit_published(PublishedSearchCatalogHintRequest {
                hint: SearchCatalogHintAdmitRequest {
                    encoded: &encoded,
                    context: publisher.context(&union)
                },
                event_ids: &shipment_ids,
                recipient: &EventGraphDeviceAccessRequest {
                    expected_device_id: publisher.identity.device_id(),
                    expected_public_key: &publisher.identity.public_key(),
                    expected_signing_public_key: &publisher.signing.public_key(),
                },
            })
            .is_err()
        );

        let unrelated = publisher.append(CatalogPublisherAppend {
            graph: root,
            operations: vec![VaultOperation::VaultCleared],
        })?;
        assert!(admit(&source_graph.clone().union(&unrelated)).is_err());
        assert!(admit(&union.union(&unrelated)).is_err());
        let superseded = publisher.append(CatalogPublisherAppend {
            graph: source_graph,
            operations: vec![publisher.pairing_approval(&recipient)?],
        })?;
        assert!(admit(&superseded).is_err());
        Ok(())
    }

    #[test]
    fn publication_cannot_omit_a_published_heads_parent_even_if_it_is_available_locally()
    -> anyhow::Result<()> {
        let publisher = CatalogPublisher::new()?;
        let recipient = CatalogPublisher::new()?;
        let graph = publisher.graph()?;
        let mut shipment_ids = graph.topological_order()?;
        let approval = publisher.append(CatalogPublisherAppend {
            graph,
            operations: vec![publisher.pairing_approval(&recipient)?],
        })?;
        let current = publisher.append(CatalogPublisherAppend {
            graph: approval,
            operations: Vec::new(),
        })?;
        shipment_ids.extend(current.heads());
        let encoded = publisher.encode(&current)?;
        assert!(
            SignedSearchCatalogHint::admit_published(PublishedSearchCatalogHintRequest {
                hint: SearchCatalogHintAdmitRequest {
                    encoded: &encoded,
                    context: publisher.context(&current)
                },
                event_ids: &shipment_ids,
                recipient: &EventGraphDeviceAccessRequest {
                    expected_device_id: recipient.identity.device_id(),
                    expected_public_key: &recipient.identity.public_key(),
                    expected_signing_public_key: &recipient.signing.public_key(),
                },
            })
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn a_revoked_publisher_cannot_sign_for_the_current_frontier() -> anyhow::Result<()> {
        let owner = CatalogPublisher::new()?;
        let member = CatalogPublisher::new()?;
        let graph = owner.graph()?;
        let auth = member
            .identity
            .auth_record(&owner.keys.secrets_key, &owner.keys.members_key)?;
        let envelopes = AuthEnvelopes::parse(auth.value.as_str())?;
        let device_id = member.identity.device_id();
        let graph = owner.append(CatalogPublisherAppend {
            graph,
            operations: vec![VaultOperation::JoinApproved {
                device_id: device_id.clone(),
                encryption_public_key: member.identity.public_key(),
                signing_public_key: member.signing.public_key(),
                label: MemberLabel::from_trusted("Second publisher".to_owned()),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            }],
        })?;
        let encoded = SignedSearchCatalogHint::sign(SearchCatalogHintSignRequest {
            context: owner.context(&graph),
            issuer: device_id,
            signer: &member.signing,
            buckets: vec![owner.bucket(2)?],
        })?;
        assert!(
            SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
                encoded: &encoded,
                context: owner.context(&graph),
            })
            .is_ok()
        );

        let revoked = owner.append(CatalogPublisherAppend {
            graph,
            operations: vec![VaultOperation::DeviceRevoked {
                device_id: device_id.clone(),
            }],
        })?;
        assert!(!EventGraphDeviceAccess::new(&revoked).has_access(
            &EventGraphDeviceAccessRequest {
                expected_device_id: device_id,
                expected_public_key: &member.identity.public_key(),
                expected_signing_public_key: &member.signing.public_key(),
            }
        )?);
        let mut signed: SignedSearchCatalogHint = serde_json::from_str(&encoded.0)?;
        signed.body.heads = ObservedHeads::from_event_ids(&revoked.heads()).as_parents();
        signed.body.epoch = revoked.current_epoch_checkpoint()?.into();
        let bytes = signed.body.canonical_bytes()?;
        signed.signature = Ed25519Signature::parse(&member.signing.sign_bytes(&bytes))?;
        let edited = EncodedSearchCatalogHint(serde_json::to_string(&signed)?);
        assert!(
            SignedSearchCatalogHint::admit(SearchCatalogHintAdmitRequest {
                encoded: &edited,
                context: owner.context(&revoked),
            })
            .is_err()
        );
        Ok(())
    }
}
