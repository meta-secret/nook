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
    clippy::return_self_not_must_use,
    clippy::result_large_err,
    clippy::unnecessary_wraps
)]

#[path = "event_log_harness.rs"]
pub mod harness;

use nook_core::{LocalEventStore, VaultError, VaultMetaState};

use harness::{EventLogDevice, ProviderBuckets, push_device_outbox, union_device_from_providers};
use nook_core::{
    DeviceIdentity, JoinRequest, MultiDeviceError, VaultMetaGraphProjection, VaultResult,
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
    let mut state = VaultMetaState::default();
    VaultMetaGraphProjection::new(&graph)
        .materialize(&mut state)
        .map_err(VaultError::from)?;
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

pub struct SimRejection {
    pub world: SimWorld,
    pub cause: VaultError,
}
impl SimRejection {
    pub fn into_cause(self) -> VaultError {
        self.cause
    }
}
pub struct JoinTransition<S> {
    pub world: SimWorld,
    pub approval: JoinApproval<S>,
}
pub struct JoinRejection<S> {
    pub world: SimWorld,
    pub approval: JoinApproval<S>,
    pub cause: VaultError,
}
impl<S> JoinRejection<S> {
    pub fn into_cause(self) -> VaultError {
        self.cause
    }
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
        providers.insert("github".to_owned(), LocalEventStore::new());
        Ok(Self { devices, providers })
    }

    pub fn genesis(&self) -> &EventLogDevice {
        self.devices
            .first()
            .unwrap_or_else(|| panic!("simulation world must contain genesis"))
    }
    pub fn device(&self, index: usize) -> &EventLogDevice {
        self.devices
            .get(index)
            .unwrap_or_else(|| panic!("simulation device index must exist"))
    }

    pub fn append(
        mut self,
        index: usize,
        operations: Vec<nook_core::VaultOperation>,
    ) -> Result<Self, SimRejection> {
        let device = self.devices.remove(index);
        match device.append_signed(operations) {
            Ok(appended) => {
                self.devices.insert(index, appended.device);
                Ok(self)
            }
            Err(rejected) => {
                self.devices.insert(index, rejected.device);
                Err(SimRejection {
                    world: self,
                    cause: rejected.cause,
                })
            }
        }
    }

    pub fn push(mut self, index: usize) -> Result<Self, SimRejection> {
        let device = self.devices.remove(index);
        let flushed = push_device_outbox(device, self.providers);
        self.providers = flushed.providers;
        self.devices.insert(index, flushed.device);
        Ok(self)
    }

    pub fn pull(mut self, index: usize) -> Result<Self, SimRejection> {
        let device = self.devices.remove(index);
        match union_device_from_providers(device, &self.providers) {
            Ok(device) => {
                self.devices.insert(index, device);
                Ok(self)
            }
            Err(rejected) => {
                self.devices.insert(index, rejected.device);
                Err(SimRejection {
                    world: self,
                    cause: rejected.cause,
                })
            }
        }
    }

    pub fn push_all(mut self) -> Result<Self, SimRejection> {
        for index in 0..self.devices.len() {
            self = self.push(index)?;
        }
        Ok(self)
    }
    pub fn pull_all(mut self) -> Result<Self, SimRejection> {
        for index in 0..self.devices.len() {
            self = self.pull(index)?;
        }
        Ok(self)
    }

    pub fn roster_view(&self, index: usize) -> VaultResult<RosterView> {
        roster_view(
            self.devices
                .get(index)
                .unwrap_or_else(|| panic!("simulation device index must exist")),
        )
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
        world: SimWorld,
        requester_index: usize,
        joiner: &DeviceIdentity,
    ) -> Result<JoinTransition<Pending>, SimRejection> {
        use nook_core::{DeviceSigningPublicKey, MemberLabel, VaultOperation};

        let join = JoinRequest {
            device_id: joiner.device_id().clone(),
            public_key: joiner.public_key(),
            signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
            requested_at: SIM_TS.to_owned(),
        };
        let world = world.append(
            requester_index,
            vec![VaultOperation::JoinRequested {
                device_id: joiner.device_id().clone(),
                encryption_public_key: joiner.public_key(),
                signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
                label: MemberLabel::from_trusted(String::new()),
            }],
        )?;
        Ok(JoinTransition {
            world,
            approval: Self {
                join,
                _state: PhantomData,
            },
        })
    }

    /// Approve the join by appending a signed `JoinApproved` event on `approver`.
    pub fn approve(
        self,
        world: SimWorld,
        approver_index: usize,
    ) -> Result<JoinTransition<Approved>, JoinRejection<Pending>> {
        use nook_core::{DeviceSigningPublicKey, MemberLabel, VaultOperation};

        // The convergence property observed here (join row removal) does not read
        // these wrapped-key envelopes, but the event store validates them as
        // age-armored on parse, so produce syntactically valid ciphertexts by
        // wrapping the keys with the approver's own vault crypto.
        let prepared: VaultResult<_> = (|| {
            let approver = world
                .devices
                .get(approver_index)
                .unwrap_or_else(|| panic!("approver index must exist"));
            Ok((
                approver.crypto.encrypt_value(&approver.secrets_key)?,
                approver.crypto.encrypt_value(&approver.members_key)?,
            ))
        })();
        let (secrets_key_ciphertext, members_key_ciphertext) = match prepared {
            Ok(prepared) => prepared,
            Err(cause) => {
                return Err(JoinRejection {
                    world,
                    approval: self,
                    cause,
                });
            }
        };

        let world = match world.append(
            approver_index,
            vec![VaultOperation::JoinApproved {
                device_id: self.join.device_id.clone(),
                encryption_public_key: self.join.public_key.clone(),
                signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
                label: MemberLabel::from_trusted(String::new()),
                secrets_key_ciphertext,
                members_key_ciphertext,
            }],
        ) {
            Ok(world) => world,
            Err(rejected) => {
                return Err(JoinRejection {
                    world: rejected.world,
                    approval: self,
                    cause: rejected.cause,
                });
            }
        };
        Ok(JoinTransition {
            world,
            approval: JoinApproval {
                join: self.join,
                _state: PhantomData,
            },
        })
    }

    /// Deny the join by appending a signed `JoinDenied` event on `approver`.
    pub fn deny(
        self,
        world: SimWorld,
        approver_index: usize,
    ) -> Result<JoinTransition<Denied>, JoinRejection<Pending>> {
        use nook_core::VaultOperation;

        let world = match world.append(
            approver_index,
            vec![VaultOperation::JoinDenied {
                device_id: self.join.device_id.clone(),
            }],
        ) {
            Ok(world) => world,
            Err(rejected) => {
                return Err(JoinRejection {
                    world: rejected.world,
                    approval: self,
                    cause: rejected.cause,
                });
            }
        };
        Ok(JoinTransition {
            world,
            approval: JoinApproval {
                join: self.join,
                _state: PhantomData,
            },
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

type StepFn = Box<dyn Fn(SimWorld) -> Result<SimWorld, SimRejection>>;

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
        F: Fn(SimWorld) -> Result<SimWorld, SimRejection> + 'static,
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
    pub fn run(&self, mut world: SimWorld, order: &[usize]) -> Result<SimWorld, SimRejection> {
        for &index in order {
            let step = self
                .steps
                .get(index)
                .unwrap_or_else(|| panic!("simulation step index must exist"));
            world = (step.run)(world)?;
        }
        Ok(world)
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
            let world = self
                .run(make_world()?, &order)
                .map_err(SimRejection::into_cause)?;
            if let Err(reason) = invariant(&world) {
                let names: Vec<&str> = order
                    .iter()
                    .map(|&index| {
                        self.steps
                            .get(index)
                            .map_or("<missing-step>", |step| step.name.as_str())
                    })
                    .collect();
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
    for (i, item) in items.iter().copied().enumerate() {
        let mut rest: Vec<usize> = Vec::with_capacity(items.len() - 1);
        rest.extend(items.iter().take(i).copied());
        rest.extend(items.iter().skip(i + 1).copied());
        for mut tail in permutations(&rest) {
            let mut perm = Vec::with_capacity(items.len());
            perm.push(item);
            perm.append(&mut tail);
            out.push(perm);
        }
    }
    out
}

/// Convenience: surface a `MultiDeviceError` as a `VaultError` in scenarios.
pub fn into_vault_error(err: MultiDeviceError) -> nook_core::VaultError {
    VaultError::from(err)
}
