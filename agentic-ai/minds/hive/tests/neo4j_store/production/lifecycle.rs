use hive::TaskStore;
use hive::model::{CompletionArtifact, EnqueueTask};
use neo4rs::query;

use super::StoreFixture;

pub(super) async fn verify(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    verify_rollout(fixture).await?;
    let blocker = verify_blocker_reuse(fixture).await?;
    crate::rearm::verify_completed_parent_gate(
        fixture.store,
        fixture.graph,
        fixture.agent_a,
        &blocker,
        fixture.suffix,
    )
    .await?;
    crate::rearm::verify_block_serializes_with_retirement(
        fixture.store,
        fixture.graph,
        fixture.agent_a,
        fixture.suffix,
    )
    .await?;
    crate::rearm::verify_enqueue_serializes_with_retirement(
        fixture.store,
        fixture.graph,
        fixture.agent_a,
        fixture.suffix,
    )
    .await?;
    verify_cancelled_reuse(fixture, &blocker).await?;
    verify_cycle_rejection(fixture).await
}

async fn verify_rollout(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let rollout = crate::task(format!("rollout-{}", fixture.suffix), Vec::new())?;
    fixture.store.enqueue(&rollout).await?;
    let interrupted =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(fixture.store.release(&interrupted, fixture.agent_a).await?);
    let resumed =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_b, 300).await?)?;
    assert_eq!(resumed.attempt_number, 1);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &resumed,
                agent_id: fixture.agent_b,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "rollout recovery complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    let mut rows = fixture
        .graph
        .execute(
            query(
                "MATCH (attempt:Attempt)-[:FOR_TASK]->(task:Task {id: $id})
                 RETURN attempt.status AS status
                 ORDER BY attempt.status",
            )
            .param("id", rollout.id.as_str()),
        )
        .await?;
    let mut statuses = Vec::new();
    while let Some(row) = rows.next().await? {
        statuses.push(row.get::<String>("status")?);
    }
    assert_eq!(statuses, ["COMPLETED", "INTERRUPTED"]);
    Ok(())
}

async fn verify_blocker_reuse(fixture: &StoreFixture<'_>) -> anyhow::Result<EnqueueTask> {
    let original = crate::task(format!("blocked-original-{}", fixture.suffix), Vec::new())?;
    let mut blocker = crate::task(format!("blocker-{}", fixture.suffix), Vec::new())?;
    blocker.priority = 100;
    fixture.store.enqueue(&original).await?;
    let original_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .block(
                &original_claim,
                fixture.agent_a,
                &blocker,
                "requires a prerequisite repair",
            )
            .await?
    );
    let blocker_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(blocker_claim.id, blocker.id);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &blocker_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "blocker complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    let resumed =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(resumed.id, original.id);
    assert_eq!(resumed.attempt_number, 1);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &resumed,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "original complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(blocker)
}

async fn verify_cancelled_reuse(
    fixture: &StoreFixture<'_>,
    blocker: &EnqueueTask,
) -> anyhow::Result<()> {
    let cancelled_root = crate::task(format!("cancelled-root-{}", fixture.suffix), Vec::new())?;
    let cancelled_blocker =
        crate::task(format!("cancelled-blocker-{}", fixture.suffix), Vec::new())?;
    fixture.store.enqueue(&cancelled_root).await?;
    let cancelled_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .block(
                &cancelled_claim,
                fixture.agent_a,
                &cancelled_blocker,
                "obsolete prerequisite repair",
            )
            .await?
    );
    assert!(
        fixture
            .store
            .cancel(&cancelled_root.id, "deferred E2E-only rerun")
            .await?
    );
    assert!(fixture.store.claim(fixture.agent_a, 300).await?.is_idle());

    let reused = crate::task(
        format!("reused-blocker-original-{}", fixture.suffix),
        Vec::new(),
    )?;
    fixture.store.enqueue(&reused).await?;
    let reused_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .block(
                &reused_claim,
                fixture.agent_a,
                blocker,
                "requires the already-completed prerequisite repair",
            )
            .await?
    );
    let mut rows = fixture
        .graph
        .execute(
            query(
                "MATCH (task:Task {id: $id})
                 RETURN task.status AS status,
                        task.blocked_reason IS NULL AS cleared_blocked_reason",
            )
            .param("id", reused.id.as_str()),
        )
        .await?;
    let state = rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("completed-blocker reuse row was missing"))?;
    assert_eq!(state.get::<String>("status")?, "READY");
    assert!(state.get::<bool>("cleared_blocked_reason")?);
    let resumed =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(resumed.id, reused.id);
    assert_eq!(resumed.attempt_number, 1);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &resumed,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "completed reused-blocker task",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(())
}

async fn verify_cycle_rejection(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let cycle_root = crate::task(format!("cycle-root-{}", fixture.suffix), Vec::new())?;
    let cycle_dependent = crate::task(
        format!("cycle-dependent-{}", fixture.suffix),
        vec![cycle_root.id.clone()],
    )?;
    fixture.store.enqueue(&cycle_root).await?;
    fixture.store.enqueue(&cycle_dependent).await?;
    let cycle_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    let mut existing_dependent = cycle_dependent.clone();
    existing_dependent.dependencies.clear();
    assert!(
        !fixture
            .store
            .block(
                &cycle_claim,
                fixture.agent_a,
                &existing_dependent,
                "must reject a dependency cycle",
            )
            .await?
    );
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &cycle_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "cycle root complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    let cycle_dependent_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &cycle_dependent_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "cycle dependent complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(())
}
