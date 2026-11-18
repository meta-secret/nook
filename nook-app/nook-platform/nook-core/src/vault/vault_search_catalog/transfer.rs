//! Signed admission of existing encrypted catalog buckets across app origins.

use crate::errors::{SessionError, VaultResult};
use crate::{
    AgeArmoredCiphertext, CanonicalEventBodyBytes, DeviceId, DeviceSigningPublicKey,
    Ed25519Signature, EpochCheckpoint, EventGraph, EventGraphDeviceAccess,
    EventGraphDeviceAccessRequest, EventId, ObservedHeads, SECRET_SEARCH_CATALOG_BUCKET_COUNT,
    SecretSearchCatalogBucket, SigningIdentity, StoreId,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

const MAX_HINT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string")]
pub struct EncodedSearchCatalogHint(String);

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
    fn invalid() -> crate::errors::VaultError {
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
        if bytes.as_ref().len() > MAX_HINT_BYTES {
            return Err(Self::invalid());
        }
        let signed = Self {
            body,
            signature: Ed25519Signature::parse(&signer.sign_bytes(&bytes))?,
        };
        let encoded = serde_json::to_string(&signed)
            .map_err(|_| SessionError::SearchCatalogSerialize("signed hint".to_owned()))?;
        if encoded.len() > MAX_HINT_BYTES {
            return Err(Self::invalid());
        }
        Ok(EncodedSearchCatalogHint(encoded))
    }

    /// Revalidate the exact current authorized graph before using its opaque buckets.
    pub fn admit(
        encoded: &EncodedSearchCatalogHint,
        context: SearchCatalogHintContext<'_>,
    ) -> VaultResult<Vec<EncryptedSearchCatalogBucket>> {
        if encoded.0.len() > MAX_HINT_BYTES {
            return Err(Self::invalid());
        }
        let signed: Self = serde_json::from_str(&encoded.0).map_err(|_| Self::invalid())?;
        signed.body.verify_shape()?;
        let heads = ObservedHeads::from_event_ids(&context.graph.heads());
        if heads.is_empty()
            || &signed.body.store_id != context.store_id
            || signed.body.heads != heads.as_event_ids()
            || signed.body.epoch
                != SearchCatalogHintEpoch::from(context.graph.current_epoch_checkpoint()?)
        {
            return Err(Self::invalid());
        }
        let key = signed.body.active_issuer_key(context.graph)?;
        let verifying_key = SigningIdentity::verifying_key_from_public_key_hex(key.as_str())?;
        SigningIdentity::verify_bytes(
            &signed.body.canonical_bytes()?,
            signed.signature.as_str(),
            &verifying_key,
        )?;
        Ok(signed.body.buckets)
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

        fn append(
            &self,
            graph: EventGraph,
            operations: Vec<VaultOperation>,
        ) -> anyhow::Result<EventGraph> {
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
            self.append(
                EventGraph::new(),
                vec![
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
            )
        }

        fn context<'a>(&'a self, graph: &'a EventGraph) -> SearchCatalogHintContext<'a> {
            SearchCatalogHintContext {
                store_id: &self.store_id,
                graph,
            }
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
        let received = SignedSearchCatalogHint::admit(&encoded, publisher.context(&graph))?;
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
            SignedSearchCatalogHint::admit(
                &encoded,
                SearchCatalogHintContext {
                    store_id: &foreign_store,
                    graph: &graph,
                },
            )
            .is_err()
        );
        let advanced = publisher.append(graph, Vec::new())?;
        assert!(SignedSearchCatalogHint::admit(&encoded, publisher.context(&advanced)).is_err());
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
        assert!(SignedSearchCatalogHint::admit(&modified, publisher.context(&graph)).is_err());
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
}
