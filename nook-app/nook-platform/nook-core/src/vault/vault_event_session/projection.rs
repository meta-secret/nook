//! Reuse of an already hydrated encrypted session after fresh graph authorization.

use crate::{DeviceId, DevicePublicKey, DeviceSigningPublicKey, EventGraph, EventId, StoreId};

/// This state never authorizes access. Callers validate the current graph grant
/// and unlocked app key before asking whether projection work can be reused.
#[derive(Debug, Default)]
pub enum VaultSessionProjection {
    #[default]
    Unhydrated,
    Hydrated(VaultHydratedProjection),
}

#[derive(Debug, PartialEq, Eq)]
pub struct VaultHydratedProjection {
    store_id: StoreId,
    app_id: DeviceId,
    encryption_public_key: DevicePublicKey,
    signing_public_key: DeviceSigningPublicKey,
    accepted_events: Vec<EventId>,
}

#[derive(Clone, Copy)]
pub struct VaultProjectionObservation<'a> {
    pub store_id: &'a StoreId,
    pub app_id: &'a DeviceId,
    pub encryption_public_key: &'a DevicePublicKey,
    pub signing_public_key: &'a DeviceSigningPublicKey,
    pub graph: &'a EventGraph,
}

#[derive(Debug)]
pub enum VaultProjectionRefresh {
    Reuse,
    Hydrate(VaultHydratedProjection),
}

impl VaultSessionProjection {
    pub fn observe(
        &self,
        observation: VaultProjectionObservation<'_>,
    ) -> Result<VaultProjectionRefresh, crate::EventError> {
        let current = VaultHydratedProjection {
            store_id: observation.store_id.clone(),
            app_id: observation.app_id.clone(),
            encryption_public_key: observation.encryption_public_key.clone(),
            signing_public_key: observation.signing_public_key.clone(),
            accepted_events: observation.graph.topological_order()?,
        };
        match self {
            Self::Hydrated(previous) if previous == &current => Ok(VaultProjectionRefresh::Reuse),
            Self::Unhydrated | Self::Hydrated(_) => Ok(VaultProjectionRefresh::Hydrate(current)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CanonicalEventBodyBytes, DeviceIdentity, EventGraphInsert, EventGraphRejection,
        EventInsertStatus, IsoTimestamp, Sha256Hex, SigningIdentity, VaultEvent, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation,
    };

    struct ProjectionFixture {
        store_id: StoreId,
        app: crate::DeviceIdentity,
        signing: SigningIdentity,
    }

    #[derive(Clone, Copy)]
    struct ProjectionFixtureObservation<'a> {
        state: &'a VaultSessionProjection,
        graph: &'a EventGraph,
    }

    impl ProjectionFixture {
        fn new() -> anyhow::Result<Self> {
            let (signing, _) = SigningIdentity::generate()?;
            Ok(Self {
                store_id: StoreId::generate()?,
                app: DeviceIdentity::generate()?,
                signing,
            })
        }

        fn event(&self, parents: Vec<EventId>) -> anyhow::Result<VaultEvent> {
            let operations = match parents.as_slice() {
                [] => vec![VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_bytes(b"projection fixture"),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                }],
                [_, ..] => Vec::new(),
            };
            Ok(VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.store_id.clone(),
                    actor_id: self.signing.actor_id()?,
                    actor_signing_public_key: self.signing.public_key(),
                    parents,
                    created_at: IsoTimestamp::parse("2026-10-07T00:00:00Z")?,
                    key_epoch: EventId::from_body_bytes(&CanonicalEventBodyBytes::from(
                        b"projection epoch".to_vec(),
                    )),
                    operations,
                },
                self.signing.signing_key(),
            )?)
        }

        fn observe(
            &self,
            observation: ProjectionFixtureObservation<'_>,
        ) -> anyhow::Result<VaultProjectionRefresh> {
            Ok(observation.state.observe(VaultProjectionObservation {
                store_id: &self.store_id,
                app_id: self.app.app_id(),
                encryption_public_key: &self.app.public_key(),
                signing_public_key: &self.signing.public_key(),
                graph: observation.graph,
            })?)
        }

        fn graph_with(&self, event: VaultEvent) -> anyhow::Result<EventGraph> {
            Ok(EventGraph::new()
                .insert(EventGraphInsert {
                    event,
                    expected_store_id: self.store_id.as_str(),
                })
                .map_err(EventGraphRejection::into_cause)?
                .graph)
        }

        fn hydrated(&self, graph: &EventGraph) -> anyhow::Result<VaultSessionProjection> {
            let VaultProjectionRefresh::Hydrate(snapshot) =
                self.observe(ProjectionFixtureObservation {
                    state: &VaultSessionProjection::Unhydrated,
                    graph,
                })?
            else {
                anyhow::bail!("initial projection must hydrate");
            };
            Ok(VaultSessionProjection::Hydrated(snapshot))
        }
    }

    #[test]
    fn repeated_authorized_graph_requires_one_hydration() -> anyhow::Result<()> {
        let fixture = ProjectionFixture::new()?;
        let graph = fixture.graph_with(fixture.event(Vec::new())?)?;
        let state = fixture.hydrated(&graph)?;
        for _ in 0..20 {
            assert!(matches!(
                fixture.observe(ProjectionFixtureObservation {
                    state: &state,
                    graph: &graph
                })?,
                VaultProjectionRefresh::Reuse
            ));
        }
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &VaultSessionProjection::Unhydrated,
                graph: &graph
            })?,
            VaultProjectionRefresh::Hydrate(_)
        ));
        Ok(())
    }

    #[test]
    fn accepted_changes_and_contraction_require_hydration() -> anyhow::Result<()> {
        let fixture = ProjectionFixture::new()?;
        let root = fixture.event(Vec::new())?;
        let root_id = root.id()?;
        let graph = fixture.graph_with(root)?;
        let state = fixture.hydrated(&graph)?;
        let expanded = graph
            .clone()
            .insert(EventGraphInsert {
                event: fixture.event(vec![root_id])?,
                expected_store_id: fixture.store_id.as_str(),
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &state,
                graph: &expanded
            })?,
            VaultProjectionRefresh::Hydrate(_)
        ));
        let expanded_state = fixture.hydrated(&expanded)?;
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &expanded_state,
                graph: &graph
            })?,
            VaultProjectionRefresh::Hydrate(_)
        ));
        Ok(())
    }

    #[test]
    fn changed_vault_app_or_signer_cannot_reuse_projection() -> anyhow::Result<()> {
        let mut fixture = ProjectionFixture::new()?;
        let graph = fixture.graph_with(fixture.event(Vec::new())?)?;
        let state = fixture.hydrated(&graph)?;
        fixture.store_id = StoreId::generate()?;
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &state,
                graph: &graph
            })?,
            VaultProjectionRefresh::Hydrate(_)
        ));
        let state = fixture.hydrated(&graph)?;
        fixture.app = DeviceIdentity::generate()?;
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &state,
                graph: &graph
            })?,
            VaultProjectionRefresh::Hydrate(_)
        ));
        let state = fixture.hydrated(&graph)?;
        let (signing, _) = SigningIdentity::generate()?;
        fixture.signing = signing;
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &state,
                graph: &graph
            })?,
            VaultProjectionRefresh::Hydrate(_)
        ));
        Ok(())
    }

    #[test]
    fn pending_event_is_not_part_of_hydrated_accepted_projection() -> anyhow::Result<()> {
        let fixture = ProjectionFixture::new()?;
        let graph = fixture.graph_with(fixture.event(Vec::new())?)?;
        let state = fixture.hydrated(&graph)?;
        let missing = EventId::from_body_bytes(&CanonicalEventBodyBytes::from(b"missing".to_vec()));
        let pending = graph
            .insert(EventGraphInsert {
                event: fixture.event(vec![missing])?,
                expected_store_id: fixture.store_id.as_str(),
            })
            .map_err(EventGraphRejection::into_cause)?;
        assert!(matches!(pending.status, EventInsertStatus::Pending(_)));
        assert!(matches!(
            fixture.observe(ProjectionFixtureObservation {
                state: &state,
                graph: &pending.graph
            })?,
            VaultProjectionRefresh::Reuse
        ));
        Ok(())
    }
}
