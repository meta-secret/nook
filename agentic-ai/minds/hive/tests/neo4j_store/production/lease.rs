use hive::TaskStore;
use neo4rs::query;

use super::StoreFixture;

pub(super) async fn verify(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    verify_expired_block(fixture).await?;
    verify_lease_exhaustion(fixture).await
}

async fn verify_expired_block(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let expired_block_parent = crate::task(
        format!("expired-block-parent-{}", fixture.suffix),
        Vec::new(),
    )?;
    let expired_blocker = crate::task(format!("expired-blocker-{}", fixture.suffix), Vec::new())?;
    fixture.store.enqueue(&expired_block_parent).await?;
    let expired_block_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    fixture
        .graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", expired_block_parent.id.as_str()),
        )
        .await?;
    assert!(
        !fixture
            .store
            .block(
                &expired_block_claim,
                fixture.agent_a,
                &expired_blocker,
                "stale worker must not mutate dependencies",
            )
            .await?
    );
    fixture
        .graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.status = 'FAILED',
                     task.lease_owner = null,
                     task.lease_token = null,
                     task.lease_until = null",
            )
            .param("id", expired_block_parent.id.as_str()),
        )
        .await?;
    Ok(())
}

async fn verify_lease_exhaustion(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let mut lease_exhausted =
        crate::task(format!("lease-exhausted-{}", fixture.suffix), Vec::new())?;
    lease_exhausted.max_attempts = 1;
    let lease_stranded = crate::task(
        format!("lease-exhausted-dependent-{}", fixture.suffix),
        vec![lease_exhausted.id.clone()],
    )?;
    fixture.store.enqueue(&lease_exhausted).await?;
    fixture.store.enqueue(&lease_stranded).await?;
    let lease_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(lease_claim.id, lease_exhausted.id);
    fixture
        .graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", lease_exhausted.id.as_str()),
        )
        .await?;
    assert!(fixture.store.claim(fixture.agent_b, 300).await?.is_idle());
    let mut rows = fixture
        .graph
        .execute(
            query(
                "MATCH (task:Task)
                 WHERE task.id IN [$failed_id, $dependent_id]
                 RETURN task.status AS status",
            )
            .param("failed_id", lease_exhausted.id.as_str())
            .param("dependent_id", lease_stranded.id.as_str()),
        )
        .await?;
    let mut statuses = Vec::new();
    while let Some(row) = rows.next().await? {
        statuses.push(row.get::<String>("status")?);
    }
    assert_eq!(statuses.len(), 2);
    assert!(
        statuses.iter().all(|status| status == "FAILED"),
        "final lease failure must propagate to every descendant: {statuses:?}"
    );
    Ok(())
}
