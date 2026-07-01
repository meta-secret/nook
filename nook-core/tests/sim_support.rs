//! Deterministic multi-device simulation kit built on the event-log harness.
//!
//! `nook-core` is fully synchronous, so "deterministic simulation" here means an
//! explicit, step-driven model: devices append signed events, push their outbox
//! into shared provider buckets, and pull remote events back — all driven by
//! ordinary function calls with no wall clock, no async runtime, and no I/O.
//! A [`Timeline`] can replay a fixed sequence of steps or exhaustively try every
//! permutation of a set of order-independent steps and assert an invariant holds
//! after each, turning the wall-clock races that make e2e tests flaky into
//! reproducible, millisecond-fast checks.

#![allow(dead_code)]
#![allow(
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::return_self_not_must_use
)]

#[path = "event_log_harness.rs"]
pub mod harness;

use harness::{EventLogDevice, ProviderBuckets, push_device_outbox, union_device_from_providers};
use nook_core::{
    DeviceIdentity, JoinRequest, MultiDeviceError, VaultResult, materialize_vault_meta_from_graph,
};
use std::marker::PhantomData;

const SIM_TS: &str = "2026-06-28T00:00:00Z";

/// A read-only snapshot of a device's materialized meta-domain state, derived
/// purely from its local event graph (no projection YAML, no crypto required).
#[derive(Debug, Default, Clone)]
pub struct RosterView {
    /// Device ids with an outstanding, unresolved join request.
    pub pending_joins: Vec<String>,
}

impl RosterView {
    pub fn has_pending_join(&self, device_id: &str) -> bool {
        self.pending_joins.iter().any(|id| id == device_id)
    }
}

/// Materialize the meta-domain (join) state a device would observe from replaying
/// its own local event log in topological order.
pub fn roster_view(device: &EventLogDevice) -> VaultResult<RosterView> {
    let graph = device.session.store.load_graph(device.store_id())?;
    let mut state = nook_core::VaultMetaState::default();
    materialize_vault_meta_from_graph(&graph, &mut state).map_err(nook_core::VaultError::from)?;
    let mut pending_joins: Vec<String> = state
        .joins
        .keys()
        .map(|device_id| device_id.as_str().to_owned())
        .collect();
    pending_joins.sort();
    Ok(RosterView { pending_joins })
}

/// A fixed set of devices sharing one vault `store_id` plus the shared provider
/// buckets they push to and pull from. Index 0 is always the genesis device.
pub struct SimWorld {
    pub devices: Vec<EventLogDevice>,
    pub providers: ProviderBuckets,
}

impl SimWorld {
    /// Build a world with a genesis device plus `replicas` peers sharing its vault.
    pub fn new(replicas: usize) -> VaultResult<Self> {
        let genesis = EventLogDevice::genesis("genesis")?;
        let mut devices = Vec::with_capacity(replicas + 1);
        for _ in 0..replicas {
            devices.push(EventLogDevice::replica_of(&genesis)?);
        }
        devices.insert(0, genesis);
        let mut providers = ProviderBuckets::new();
        providers.insert("github".to_owned(), nook_core::LocalEventStore::new());
        Ok(Self { devices, providers })
    }

    pub fn genesis(&mut self) -> &mut EventLogDevice {
        &mut self.devices[0]
    }

    pub fn device(&mut self, index: usize) -> &mut EventLogDevice {
        &mut self.devices[index]
    }

    /// Flush one device's pending outbox into every shared provider bucket.
    pub fn push(&mut self, index: usize) -> VaultResult<()> {
        push_device_outbox(&mut self.devices[index], &mut self.providers)
    }

    /// Union all events currently in the shared buckets into one device's log.
    pub fn pull(&mut self, index: usize) -> VaultResult<()> {
        union_device_from_providers(&mut self.devices[index], &self.providers)
    }

    /// Push every device's outbox to the shared buckets.
    pub fn push_all(&mut self) -> VaultResult<()> {
        for index in 0..self.devices.len() {
            self.push(index)?;
        }
        Ok(())
    }

    /// Pull the shared buckets into every device's log.
    pub fn pull_all(&mut self) -> VaultResult<()> {
        for index in 0..self.devices.len() {
            self.pull(index)?;
        }
        Ok(())
    }

    pub fn roster_view(&self, index: usize) -> VaultResult<RosterView> {
        roster_view(&self.devices[index])
    }
}

/// Typestate marker: the join request has been recorded but not yet resolved.
pub struct Pending;
/// Typestate marker: the join request was approved (roster + auth granted).
pub struct Approved;
/// Typestate marker: the join request was denied.
pub struct Denied;

/// A join request modeled as a compile-time state machine over the existing pure
/// `nook_core` join/approve logic. Approving or denying consumes the value, so a
/// double-approve or approve-then-deny is a compile error rather than a runtime
/// check — the invalid transitions are simply not expressible.
pub struct JoinApproval<S> {
    join: JoinRequest,
    _state: PhantomData<S>,
}

impl JoinApproval<Pending> {
    /// Record a fresh join request from `joiner` and append the signed
    /// `JoinRequested` event on the requesting side of the world.
    pub fn request(
        world: &mut SimWorld,
        requester_index: usize,
        joiner: &DeviceIdentity,
    ) -> VaultResult<Self> {
        use nook_core::{DeviceSigningPublicKey, MemberLabel, VaultOperation};

        let join = JoinRequest {
            device_id: joiner.device_id().clone(),
            public_key: joiner.public_key(),
            requested_at: SIM_TS.to_owned(),
        };
        world.devices[requester_index].append_signed(vec![VaultOperation::JoinRequested {
            device_id: joiner.device_id().clone(),
            encryption_public_key: joiner.public_key(),
            signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
            label: MemberLabel::from_trusted(String::new()),
        }])?;
        Ok(Self {
            join,
            _state: PhantomData,
        })
    }

    /// Approve the join by appending a signed `JoinApproved` event on `approver`.
    pub fn approve(
        self,
        world: &mut SimWorld,
        approver_index: usize,
    ) -> VaultResult<JoinApproval<Approved>> {
        use nook_core::{DeviceSigningPublicKey, MemberLabel, VaultOperation};

        // The convergence property observed here (join row removal) does not read
        // these wrapped-key envelopes, but the event store validates them as
        // age-armored on parse, so produce syntactically valid ciphertexts by
        // wrapping the keys with the approver's own vault crypto.
        let approver = &world.devices[approver_index];
        let secrets_key_ciphertext = approver
            .crypto
            .encrypt_value(&approver.secrets_key)
            .map_err(nook_core::VaultError::from)?;
        let members_key_ciphertext = approver
            .crypto
            .encrypt_value(&approver.members_key)
            .map_err(nook_core::VaultError::from)?;

        world.devices[approver_index].append_signed(vec![VaultOperation::JoinApproved {
            device_id: self.join.device_id.clone(),
            encryption_public_key: self.join.public_key.clone(),
            signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
            label: MemberLabel::from_trusted(String::new()),
            secrets_key_ciphertext,
            members_key_ciphertext,
        }])?;
        Ok(JoinApproval {
            join: self.join,
            _state: PhantomData,
        })
    }

    /// Deny the join by appending a signed `JoinDenied` event on `approver`.
    pub fn deny(
        self,
        world: &mut SimWorld,
        approver_index: usize,
    ) -> VaultResult<JoinApproval<Denied>> {
        use nook_core::VaultOperation;

        world.devices[approver_index].append_signed(vec![VaultOperation::JoinDenied {
            device_id: self.join.device_id.clone(),
        }])?;
        Ok(JoinApproval {
            join: self.join,
            _state: PhantomData,
        })
    }
}

impl<S> JoinApproval<S> {
    pub fn device_id(&self) -> &str {
        self.join.device_id.as_str()
    }
}

/// A named, ordered set of steps over a shared [`SimWorld`]. Steps are closures so
/// the runner can execute them in any order or across every permutation.
pub struct Timeline {
    steps: Vec<Step>,
}

type StepFn = Box<dyn Fn(&mut SimWorld) -> VaultResult<()>>;

struct Step {
    name: String,
    run: StepFn,
}

impl Timeline {
    pub fn new() -> Self {
        Self { steps: Vec::new() }
    }

    pub fn step<F>(mut self, name: &str, run: F) -> Self
    where
        F: Fn(&mut SimWorld) -> VaultResult<()> + 'static,
    {
        self.steps.push(Step {
            name: name.to_owned(),
            run: Box::new(run),
        });
        self
    }

    pub fn len(&self) -> usize {
        self.steps.len()
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    /// Run the steps against `world` in the given index order.
    pub fn run(&self, world: &mut SimWorld, order: &[usize]) -> VaultResult<()> {
        for &index in order {
            (self.steps[index].run)(world)?;
        }
        Ok(())
    }

    /// For every permutation of this timeline's steps, build a fresh world via
    /// `make_world`, run the steps in that order, and assert `invariant` holds.
    /// Panics with the offending order's step names if the invariant ever fails.
    pub fn run_all_permutations<MakeWorld, Invariant>(
        &self,
        make_world: MakeWorld,
        invariant: Invariant,
    ) -> VaultResult<()>
    where
        MakeWorld: Fn() -> VaultResult<SimWorld>,
        Invariant: Fn(&SimWorld) -> Result<(), String>,
    {
        let indices: Vec<usize> = (0..self.steps.len()).collect();
        for order in permutations(&indices) {
            let mut world = make_world()?;
            self.run(&mut world, &order)?;
            if let Err(reason) = invariant(&world) {
                let names: Vec<&str> = order.iter().map(|&i| self.steps[i].name.as_str()).collect();
                panic!(
                    "invariant failed after step order [{}]: {reason}",
                    names.join(" -> ")
                );
            }
        }
        Ok(())
    }
}

impl Default for Timeline {
    fn default() -> Self {
        Self::new()
    }
}

/// Hand-rolled recursive permutation generator (no external dependency). Intended
/// for the small step counts (N <= ~6) used by these scenarios.
fn permutations(items: &[usize]) -> Vec<Vec<usize>> {
    if items.len() <= 1 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for i in 0..items.len() {
        let mut rest: Vec<usize> = Vec::with_capacity(items.len() - 1);
        rest.extend_from_slice(&items[..i]);
        rest.extend_from_slice(&items[i + 1..]);
        for mut tail in permutations(&rest) {
            let mut perm = Vec::with_capacity(items.len());
            perm.push(items[i]);
            perm.append(&mut tail);
            out.push(perm);
        }
    }
    out
}

/// Convenience: surface a `MultiDeviceError` as a `VaultError` in scenarios.
pub fn into_vault_error(err: MultiDeviceError) -> nook_core::VaultError {
    nook_core::VaultError::from(err)
}
