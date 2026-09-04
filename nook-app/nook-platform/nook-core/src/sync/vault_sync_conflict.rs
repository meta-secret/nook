//! Typed whole-vault sync conflicts.

use crate::{IdentityVaultAppGrantKind, VaultOperation};

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncConflictKind {
    Content,
    StoreId,
}

/// Closed assessment of whether replacing the current local vault can lose data.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurrentVaultReplaceability {
    Replaceable,
    PreserveRequired,
    Unknown,
}

/// Public facts needed to explain whether one local identity can open a provider vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderVaultIdentityObservation {
    pub identity_id: String,
    pub identity_label: String,
    pub linked_to_provider_vault: bool,
    pub protected_local_app_available: bool,
    pub is_current_app: bool,
    pub app_grant: crate::IdentityVaultAppGrantKind,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderVaultIdentityEligibility {
    LinkedAndPrepared,
    LinkedButUnavailable,
    NotLinked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderVaultIdentityProjection {
    pub identity_id: String,
    pub identity_label: String,
    pub is_current_app: bool,
    pub eligibility: ProviderVaultIdentityEligibility,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderVaultDecision {
    AdoptProviderVault,
    PreserveBoth,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderVaultDecisionReason {
    ReadyToAdopt,
    CurrentVaultContainsUserData,
    CurrentVaultStateUnavailable,
    LinkedIdentityUnavailable,
    NoLinkedIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderVaultDecisionProjection {
    pub decision: ProviderVaultDecision,
    pub reason: ProviderVaultDecisionReason,
    pub identities: Vec<ProviderVaultIdentityProjection>,
}

/// Derive replaceability from an accepted local event graph.
///
/// Missing or ambiguous genesis evidence, pending or quarantined events,
/// unsupported event schemas, projection failures, and unresolved conflicts
/// are all unknown. Only one accepted root whose sole operation is an empty
/// vault import is replaceable. Any accepted descendant or nonempty recognized
/// genesis must be preserved, even when its final projection has no live data.
#[must_use]
pub fn classify_current_vault_replaceability(
    graph: &crate::EventGraph,
    store_id: &str,
) -> CurrentVaultReplaceability {
    if graph.is_empty() || !graph.pending_events().is_empty() || !graph.quarantined().is_empty() {
        return CurrentVaultReplaceability::Unknown;
    }
    let Ok(projection) = crate::project_vault(graph, store_id) else {
        return CurrentVaultReplaceability::Unknown;
    };
    if projection.unresolved_schema || projection.has_blocking_conflicts() {
        return CurrentVaultReplaceability::Unknown;
    }
    let roots = graph
        .events()
        .filter(|(_, event)| event.body.parents.is_empty())
        .collect::<Vec<_>>();
    let [(_, root)] = roots.as_slice() else {
        return CurrentVaultReplaceability::Unknown;
    };
    let [
        VaultOperation::VaultImported {
            secrets,
            password_entries,
            ..
        },
    ] = root.body.operations.as_slice()
    else {
        return CurrentVaultReplaceability::Unknown;
    };
    if !secrets.is_empty() || !password_entries.is_empty() || graph.len() > 1 {
        return CurrentVaultReplaceability::PreserveRequired;
    }
    CurrentVaultReplaceability::Replaceable
}

/// Project a conservative provider-vault choice from public observations.
///
/// Adoption is recommended only when the local vault is proven empty and at
/// least one identity is both linked to the provider vault and prepared on this
/// device. Every other state preserves both vaults. This function does not
/// inspect or expose passkey material, app keys, DEKs, or vault contents.
#[must_use]
pub fn project_provider_vault_decision(
    current_vault: CurrentVaultReplaceability,
    identities: Vec<ProviderVaultIdentityObservation>,
) -> ProviderVaultDecisionProjection {
    let identities = identities
        .into_iter()
        .map(|identity| ProviderVaultIdentityProjection {
            eligibility: if !identity.linked_to_provider_vault {
                ProviderVaultIdentityEligibility::NotLinked
            } else if identity.protected_local_app_available
                && identity.app_grant == IdentityVaultAppGrantKind::Granted
            {
                ProviderVaultIdentityEligibility::LinkedAndPrepared
            } else {
                ProviderVaultIdentityEligibility::LinkedButUnavailable
            },
            identity_id: identity.identity_id,
            identity_label: identity.identity_label,
            is_current_app: identity.is_current_app,
        })
        .collect::<Vec<_>>();

    let (decision, reason) = match current_vault {
        CurrentVaultReplaceability::PreserveRequired => (
            ProviderVaultDecision::PreserveBoth,
            ProviderVaultDecisionReason::CurrentVaultContainsUserData,
        ),
        CurrentVaultReplaceability::Unknown => (
            ProviderVaultDecision::PreserveBoth,
            ProviderVaultDecisionReason::CurrentVaultStateUnavailable,
        ),
        CurrentVaultReplaceability::Replaceable
            if identities.iter().any(|identity| {
                identity.eligibility == ProviderVaultIdentityEligibility::LinkedAndPrepared
            }) =>
        {
            (
                ProviderVaultDecision::AdoptProviderVault,
                ProviderVaultDecisionReason::ReadyToAdopt,
            )
        }
        CurrentVaultReplaceability::Replaceable
            if identities.iter().any(|identity| {
                identity.eligibility == ProviderVaultIdentityEligibility::LinkedButUnavailable
            }) =>
        {
            (
                ProviderVaultDecision::PreserveBoth,
                ProviderVaultDecisionReason::LinkedIdentityUnavailable,
            )
        }
        CurrentVaultReplaceability::Replaceable => (
            ProviderVaultDecision::PreserveBoth,
            ProviderVaultDecisionReason::NoLinkedIdentity,
        ),
    };

    ProviderVaultDecisionProjection {
        decision,
        reason,
        identities,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentSyncConflict {
    pub local_version: u64,
    pub remote_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreIdSyncConflict {
    pub local_store_id: String,
    pub remote_store_id: String,
}

/// Variant-specific domain details for a paused whole-vault sync operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultSyncConflict {
    Content(ContentSyncConflict),
    StoreId(StoreIdSyncConflict),
}

impl VaultSyncConflict {
    #[must_use]
    pub const fn kind(&self) -> VaultSyncConflictKind {
        match self {
            Self::Content(_) => VaultSyncConflictKind::Content,
            Self::StoreId(_) => VaultSyncConflictKind::StoreId,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{IdentityVaultAppGrantKind, VaultEvent, VaultEventSchemaVersion, VaultOperation};

    use super::*;
    use crate::{
        EncryptedSecretPayload, EventGraph, EventId, GenesisImportPayload, IsoTimestamp,
        OpaqueCiphertext, SecretFingerprint, SecretId, SecretType, Sha256Hex, SigningIdentity,
        StoreId, build_genesis_import_event,
    };

    const TEST_STORE_ID: &str = "store_conflictux1";

    fn encrypted_secret(secret_id: &str) -> anyhow::Result<EncryptedSecretPayload> {
        Ok(EncryptedSecretPayload {
            id: SecretId::parse(secret_id)?,
            secret_type: SecretType::SecureNote,
            ciphertext: OpaqueCiphertext::from_trusted("encrypted-secret".to_owned()),
            identity_fingerprint: SecretFingerprint::from_trusted(
                "identity-fingerprint".to_owned(),
            ),
            fingerprint: SecretFingerprint::from_trusted("version-fingerprint".to_owned()),
        })
    }

    fn accepted_graph_fixture(
        with_secret: bool,
    ) -> anyhow::Result<(EventGraph, SigningIdentity, EventId)> {
        let signing = SigningIdentity::generate()?.0;
        let secrets = with_secret
            .then(|| encrypted_secret("secret_conflictux1"))
            .transpose()?
            .into_iter()
            .collect();
        let event = build_genesis_import_event(
            &StoreId::parse(TEST_STORE_ID)?,
            &signing.actor_id()?,
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())?,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets,
                password_entries: Vec::new(),
            },
            &IsoTimestamp::parse("2026-09-01T00:00:00Z")?,
            signing.signing_key(),
        )?;
        let event_id = event.id()?;
        let mut graph = EventGraph::new();
        graph.insert(event, TEST_STORE_ID)?;
        Ok((graph, signing, event_id))
    }

    fn accepted_graph(with_secret: bool) -> anyhow::Result<EventGraph> {
        Ok(accepted_graph_fixture(with_secret)?.0)
    }

    fn append_operation(
        graph: &mut EventGraph,
        signing: &SigningIdentity,
        parent: EventId,
        operation: crate::VaultOperation,
    ) -> anyhow::Result<EventId> {
        let event = VaultEvent::sign(
            crate::VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: StoreId::parse(TEST_STORE_ID)?,
                actor_id: signing.actor_id()?,
                actor_signing_public_key: signing.public_key(),
                parents: vec![parent],
                created_at: IsoTimestamp::parse("2026-09-01T00:01:00Z")?,
                key_epoch: EventId::from_sha256_hex(
                    Sha256Hex::from_trusted("1".repeat(64)).as_str(),
                )?,
                operations: vec![operation],
            },
            signing.signing_key(),
        )?;
        let event_id = event.id()?;
        graph.insert(event, TEST_STORE_ID)?;
        Ok(event_id)
    }

    #[test]
    fn conflict_variants_expose_only_their_own_details() {
        let content = VaultSyncConflict::Content(ContentSyncConflict {
            local_version: 4,
            remote_version: 5,
        });
        assert_eq!(content.kind(), VaultSyncConflictKind::Content);
        assert!(matches!(
            content,
            VaultSyncConflict::Content(ContentSyncConflict {
                local_version: 4,
                remote_version: 5
            })
        ));

        let store_id = VaultSyncConflict::StoreId(StoreIdSyncConflict {
            local_store_id: "local".to_owned(),
            remote_store_id: "remote".to_owned(),
        });
        assert_eq!(store_id.kind(), VaultSyncConflictKind::StoreId);
        assert!(matches!(
            store_id,
            VaultSyncConflict::StoreId(StoreIdSyncConflict {
                local_store_id,
                remote_store_id
            }) if local_store_id == "local" && remote_store_id == "remote"
        ));
    }

    fn identity(
        identity_id: &str,
        linked_to_provider_vault: bool,
        protected_local_app_available: bool,
    ) -> ProviderVaultIdentityObservation {
        ProviderVaultIdentityObservation {
            identity_id: identity_id.to_owned(),
            identity_label: format!("Identity {identity_id}"),
            linked_to_provider_vault,
            protected_local_app_available,
            is_current_app: identity_id == "personal",
            app_grant: if protected_local_app_available {
                IdentityVaultAppGrantKind::Granted
            } else {
                IdentityVaultAppGrantKind::NotGranted
            },
        }
    }

    #[test]
    fn empty_local_vault_recommends_adoption_when_an_identity_is_prepared() {
        let projection = project_provider_vault_decision(
            CurrentVaultReplaceability::Replaceable,
            vec![
                identity("personal", true, false),
                identity("work", true, true),
            ],
        );

        assert_eq!(
            projection.decision,
            ProviderVaultDecision::AdoptProviderVault
        );
        assert_eq!(projection.reason, ProviderVaultDecisionReason::ReadyToAdopt);
        assert_eq!(
            projection
                .identities
                .iter()
                .map(|identity| identity.eligibility)
                .collect::<Vec<_>>(),
            vec![
                ProviderVaultIdentityEligibility::LinkedButUnavailable,
                ProviderVaultIdentityEligibility::LinkedAndPrepared,
            ]
        );
    }

    #[test]
    fn nonempty_or_unknown_local_vault_is_never_recommended_for_replacement() {
        for (observation, reason) in [
            (
                CurrentVaultReplaceability::PreserveRequired,
                ProviderVaultDecisionReason::CurrentVaultContainsUserData,
            ),
            (
                CurrentVaultReplaceability::Unknown,
                ProviderVaultDecisionReason::CurrentVaultStateUnavailable,
            ),
        ] {
            let projection =
                project_provider_vault_decision(observation, vec![identity("ready", true, true)]);
            assert_eq!(projection.decision, ProviderVaultDecision::PreserveBoth);
            assert_eq!(projection.reason, reason);
        }
    }

    #[test]
    fn empty_local_vault_explains_unavailable_and_unlinked_identities() {
        let unavailable = project_provider_vault_decision(
            CurrentVaultReplaceability::Replaceable,
            vec![
                identity("locked", true, false),
                identity("other", false, true),
            ],
        );
        assert_eq!(unavailable.decision, ProviderVaultDecision::PreserveBoth);
        assert_eq!(
            unavailable.reason,
            ProviderVaultDecisionReason::LinkedIdentityUnavailable
        );
        assert_eq!(
            unavailable.identities[1].eligibility,
            ProviderVaultIdentityEligibility::NotLinked
        );

        let unlinked = project_provider_vault_decision(
            CurrentVaultReplaceability::Replaceable,
            vec![identity("other", false, false)],
        );
        assert_eq!(unlinked.decision, ProviderVaultDecision::PreserveBoth);
        assert_eq!(
            unlinked.reason,
            ProviderVaultDecisionReason::NoLinkedIdentity
        );
    }

    #[test]
    fn linked_identity_requires_a_protected_app_and_both_dek_envelopes() {
        let mut observations = Vec::new();
        for (identity_id, protected, grant) in [
            ("missing-app", false, IdentityVaultAppGrantKind::Granted),
            (
                "missing-envelope",
                true,
                IdentityVaultAppGrantKind::NotGranted,
            ),
        ] {
            let mut observation = identity(identity_id, true, protected);
            observation.app_grant = grant;
            observations.push(observation);
        }

        let projection =
            project_provider_vault_decision(CurrentVaultReplaceability::Replaceable, observations);
        assert_eq!(projection.decision, ProviderVaultDecision::PreserveBoth);
        assert_eq!(
            projection.reason,
            ProviderVaultDecisionReason::LinkedIdentityUnavailable
        );
        assert!(projection.identities.iter().all(|identity| {
            identity.eligibility == ProviderVaultIdentityEligibility::LinkedButUnavailable
        }));
    }

    #[test]
    fn only_pristine_empty_genesis_is_replaceable() -> anyhow::Result<()> {
        assert_eq!(
            classify_current_vault_replaceability(&accepted_graph(false)?, TEST_STORE_ID),
            CurrentVaultReplaceability::Replaceable
        );
        assert_eq!(
            classify_current_vault_replaceability(&accepted_graph(true)?, TEST_STORE_ID),
            CurrentVaultReplaceability::PreserveRequired
        );
        Ok(())
    }

    #[test]
    fn missing_or_mismatched_graph_evidence_is_unknown() -> anyhow::Result<()> {
        assert_eq!(
            classify_current_vault_replaceability(&EventGraph::new(), TEST_STORE_ID),
            CurrentVaultReplaceability::Unknown
        );
        assert_eq!(
            classify_current_vault_replaceability(&accepted_graph(false)?, "store_otherstore1"),
            CurrentVaultReplaceability::Unknown
        );
        Ok(())
    }

    #[test]
    fn nonempty_graph_without_accepted_genesis_is_unknown() -> anyhow::Result<()> {
        let signing = SigningIdentity::generate()?.0;
        let mut graph = EventGraph::new();
        let missing_parent =
            EventId::from_sha256_hex(Sha256Hex::from_trusted("2".repeat(64)).as_str())?;
        append_operation(
            &mut graph,
            &signing,
            missing_parent,
            VaultOperation::VaultCleared,
        )?;

        assert!(!graph.is_empty());
        assert!(!graph.pending_events().is_empty());
        assert_eq!(
            classify_current_vault_replaceability(&graph, TEST_STORE_ID),
            CurrentVaultReplaceability::Unknown
        );
        Ok(())
    }

    #[test]
    fn accepted_post_genesis_nonsecret_mutation_requires_preservation() -> anyhow::Result<()> {
        let (mut graph, signing, genesis) = accepted_graph_fixture(false)?;
        append_operation(&mut graph, &signing, genesis, VaultOperation::VaultCleared)?;

        assert_eq!(
            classify_current_vault_replaceability(&graph, TEST_STORE_ID),
            CurrentVaultReplaceability::PreserveRequired
        );
        Ok(())
    }

    #[test]
    fn created_then_deleted_secret_still_requires_preservation() -> anyhow::Result<()> {
        let (mut graph, signing, genesis) = accepted_graph_fixture(false)?;
        let secret_id = SecretId::parse("secret_conflictux2")?;
        let created = append_operation(
            &mut graph,
            &signing,
            genesis,
            VaultOperation::SecretCreated {
                secret: encrypted_secret(secret_id.as_str())?,
            },
        )?;
        append_operation(
            &mut graph,
            &signing,
            created,
            VaultOperation::SecretDeleted { secret_id },
        )?;

        assert_eq!(
            classify_current_vault_replaceability(&graph, TEST_STORE_ID),
            CurrentVaultReplaceability::PreserveRequired
        );
        Ok(())
    }
}
