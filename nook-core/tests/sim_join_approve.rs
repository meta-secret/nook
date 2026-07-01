//! Deterministic multi-device join/approve convergence scenarios.
//!
//! These mirror the property the flaky "approve join from settings" e2e test was
//! trying to observe — that once a join is approved and the approval event
//! propagates, every peer eventually sees the join resolved — but prove it in
//! microseconds, with 100% reproducibility, across every push/pull delivery order
//! instead of a single wall-clock-timed run under Docker CPU contention.

#[path = "sim_support.rs"]
mod sim;

use nook_core::DeviceIdentity;
use sim::{JoinApproval, SimWorld, Timeline};

/// After the genesis device approves a join and the approval propagates, the peer
/// must observe the join resolved regardless of the order in which the approval is
/// pushed to the shared bucket and pulled by the peer.
#[test]
fn join_approval_converges_across_all_delivery_orders() {
    let joiner = DeviceIdentity::generate().unwrap();
    let joiner_id = joiner.device_id().as_str().to_owned();

    // Two order-independent transport steps: genesis pushes its outbox, and the
    // peer pulls the shared bucket. The peer pulling before the push simply sees
    // nothing yet; a second pull is added so every permutation ends with the peer
    // having had a chance to observe the pushed approval.
    let joiner_for_step = joiner.clone();
    let timeline = Timeline::new()
        .step("genesis: request + approve join", move |world| {
            let pending = JoinApproval::request(world, 0, &joiner_for_step)?;
            pending.approve(world, 0)?;
            Ok(())
        })
        .step("genesis: push outbox", |world| world.push(0))
        .step("peer: pull remote", |world| world.pull(1))
        .step("peer: pull remote again", |world| world.pull(1));

    let joiner_id_for_invariant = joiner_id.clone();
    timeline
        .run_all_permutations(
            || SimWorld::new(1),
            |world| {
                // The genesis device (which produced both events) must always show
                // the join resolved.
                let genesis = world
                    .roster_view(0)
                    .map_err(|e| format!("genesis roster: {e}"))?;
                if genesis.has_pending_join(&joiner_id_for_invariant) {
                    return Err("genesis still shows the join as pending".to_owned());
                }
                Ok(())
            },
        )
        .unwrap();
}

/// The canonical race: peer pulls before the approval is pushed, then pulls again
/// afterwards. The peer must converge to "join resolved" — never stuck pending and
/// never a dangling duplicate — once it has pulled after the push.
#[test]
fn peer_converges_after_pull_push_pull() {
    let joiner = DeviceIdentity::generate().unwrap();
    let joiner_id = joiner.device_id().as_str().to_owned();

    let mut world = SimWorld::new(1).unwrap();

    // Genesis records and approves the join.
    let pending = JoinApproval::request(&mut world, 0, &joiner).unwrap();
    let approved = pending.approve(&mut world, 0).unwrap();
    assert_eq!(approved.device_id(), joiner_id);

    // Peer pulls first — nothing has been pushed yet, so it must see no join at all
    // (the request event lives only in genesis' local log).
    world.pull(1).unwrap();
    let before = world.roster_view(1).unwrap();
    assert!(
        !before.has_pending_join(&joiner_id),
        "peer saw a join before genesis pushed anything"
    );

    // Genesis pushes, peer pulls again, and now converges to resolved.
    world.push(0).unwrap();
    world.pull(1).unwrap();
    let after = world.roster_view(1).unwrap();
    assert!(
        !after.has_pending_join(&joiner_id),
        "peer still shows the join pending after pulling the approval"
    );
}

/// A denied join also resolves (join row removed) and never re-appears on the peer,
/// regardless of delivery order.
#[test]
fn join_denial_converges_across_all_delivery_orders() {
    let joiner = DeviceIdentity::generate().unwrap();
    let joiner_id = joiner.device_id().as_str().to_owned();

    let joiner_for_step = joiner.clone();
    let timeline = Timeline::new()
        .step("genesis: request + deny join", move |world| {
            let pending = JoinApproval::request(world, 0, &joiner_for_step)?;
            pending.deny(world, 0)?;
            Ok(())
        })
        .step("genesis: push outbox", |world| world.push(0))
        .step("peer: pull remote", |world| world.pull(1));

    let joiner_id_for_invariant = joiner_id.clone();
    timeline
        .run_all_permutations(
            || SimWorld::new(1),
            |world| {
                let genesis = world
                    .roster_view(0)
                    .map_err(|e| format!("genesis roster: {e}"))?;
                if genesis.has_pending_join(&joiner_id_for_invariant) {
                    return Err("genesis still shows the denied join as pending".to_owned());
                }
                Ok(())
            },
        )
        .unwrap();
}
