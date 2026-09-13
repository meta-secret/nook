use anyhow::Context;
use hive::TaskStore;
use hive::model::{ClaimOutcome, CompletionArtifact, EnqueueTask};
use hive::observer::AlertKind;
use neo4rs::query;

use super::StoreFixture;

pub(super) async fn verify(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let exhausted = verify_failure_propagation(fixture).await?;
    verify_main_repair_retries(fixture).await?;
    verify_retired_and_reused(fixture, &exhausted).await?;
    crate::rearm::verify_blocked_release_retry(
        fixture.store,
        fixture.graph,
        fixture.agent_a,
        fixture.suffix,
    )
    .await
}

async fn verify_failure_propagation(fixture: &StoreFixture<'_>) -> anyhow::Result<EnqueueTask> {
    let mut exhausted = crate::task(format!("exhausted-{}", fixture.suffix), Vec::new())?;
    exhausted.max_attempts = 1;
    let stranded = crate::task(
        format!("exhausted-dependent-{}", fixture.suffix),
        vec![exhausted.id.clone()],
    )?;
    fixture.store.enqueue(&exhausted).await?;
    fixture.store.enqueue(&stranded).await?;
    let exhausted_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .fail(&exhausted_claim, fixture.agent_a, "terminal failure")
            .await?
    );
    let mut rows = fixture
        .graph
        .execute(
            query(
                "MATCH (task:Task)
                 WHERE task.id IN [$failed_id, $dependent_id]
                 RETURN task.id AS id, task.status AS status",
            )
            .param("failed_id", exhausted.id.as_str())
            .param("dependent_id", stranded.id.as_str()),
        )
        .await?;
    let mut statuses = Vec::new();
    while let Some(row) = rows.next().await? {
        statuses.push((row.get::<String>("id")?, row.get::<String>("status")?));
    }
    assert_eq!(statuses.len(), 2);
    assert!(
        statuses.iter().all(|(_, status)| status == "FAILED"),
        "terminal dependency failure must propagate to every blocked descendant"
    );
    let dependency_alert = fixture
        .store
        .observer_snapshot("en")
        .await?
        .alerts
        .into_iter()
        .find(|alert| alert.task_id == stranded.id.as_str())
        .ok_or_else(|| anyhow::anyhow!("propagated dependency alert was missing"))?;
    assert_eq!(dependency_alert.kind, AlertKind::DependencyFailed);
    let late_dependent = crate::task(
        format!("late-failed-dependent-{}", fixture.suffix),
        vec![exhausted.id.clone()],
    )?;
    fixture.store.enqueue(&late_dependent).await?;
    let late_dependency_alert = fixture
        .store
        .observer_snapshot("en")
        .await?
        .alerts
        .into_iter()
        .find(|alert| alert.task_id == late_dependent.id.as_str())
        .ok_or_else(|| anyhow::anyhow!("late dependency alert was missing"))?;
    assert_eq!(late_dependency_alert.kind, AlertKind::DependencyFailed);
    Ok(exhausted)
}

async fn verify_main_repair_retries(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let mut repair = crate::task(format!("main-failure-{}", fixture.suffix), Vec::new())?;
    repair.kind = "main-repair".into();
    repair.max_attempts = 1;
    fixture.store.enqueue(&repair).await?;
    let ClaimOutcome::Claimed(repair_claim) = fixture.store.claim(fixture.agent_a, 300).await?
    else {
        return Err(anyhow::anyhow!("Main repair must be available"));
    };
    assert!(
        fixture
            .store
            .fail(
                &repair_claim,
                fixture.agent_a,
                "invalid structured output schema",
            )
            .await?
    );
    let status = fixture.store.queue_status(200).await?;
    let failed_repair = status
        .iter()
        .find(|task| task.id == repair.id.as_str())
        .context("queue status must contain the failed Main repair")?;
    assert_eq!(failed_repair.status, "FAILED");
    assert_eq!(failed_repair.latest_attempt_status, "FAILED");
    assert!(
        failed_repair
            .latest_error
            .contains("invalid structured output schema")
    );
    verify_rearm_budgets(fixture, &repair).await
}

async fn verify_rearm_budgets(
    fixture: &StoreFixture<'_>,
    repair: &EnqueueTask,
) -> anyhow::Result<()> {
    assert!(
        fixture
            .store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await?
    );
    assert!(
        !fixture
            .store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await?,
        "one release must not grant an unbounded retry budget"
    );
    for attempt_number in 2..=4 {
        let ClaimOutcome::Claimed(retried_claim) =
            fixture.store.claim(fixture.agent_a, 300).await?
        else {
            return Err(anyhow::anyhow!("retried Main repair must be available"));
        };
        assert_eq!(retried_claim.id, repair.id);
        assert_eq!(retried_claim.attempt_number, attempt_number);
        assert!(
            fixture
                .store
                .fail(
                    &retried_claim,
                    fixture.agent_a,
                    &format!("repair attempt {attempt_number} failed"),
                )
                .await?
        );
    }
    let status = fixture.store.queue_status(200).await?;
    let failed_repair = status
        .iter()
        .find(|task| task.id == repair.id.as_str())
        .context("queue status must contain the retried Main repair")?;
    assert_eq!(failed_repair.latest_attempt_status, "FAILED");
    assert_eq!(failed_repair.previous_attempt_status, "FAILED");
    assert!(
        failed_repair
            .latest_error
            .contains("repair attempt 4 failed")
    );
    assert!(
        failed_repair
            .previous_error
            .contains("repair attempt 3 failed")
    );
    verify_distinct_release(fixture, repair).await
}

async fn verify_distinct_release(
    fixture: &StoreFixture<'_>,
    repair: &EnqueueTask,
) -> anyhow::Result<()> {
    assert!(
        !fixture
            .store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await?,
        "an exhausted recovery budget must not be rearmed by the same release"
    );
    assert!(
        fixture
            .store
            .retry_failed_main_task(
                &repair.id,
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            )
            .await?,
        "a distinct repaired release must receive one bounded budget"
    );
    let release_b_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(release_b_claim.id, repair.id);
    assert_eq!(release_b_claim.attempt_number, 5);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &release_b_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "platform repaired",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(())
}

async fn verify_retired_and_reused(
    fixture: &StoreFixture<'_>,
    exhausted: &EnqueueTask,
) -> anyhow::Result<()> {
    let mut retired_repair = crate::task(
        format!("retired-main-failure-{}", fixture.suffix),
        Vec::new(),
    )?;
    retired_repair.kind = "main-repair".into();
    retired_repair.max_attempts = 1;
    fixture.store.enqueue(&retired_repair).await?;
    let retired_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .fail(&retired_claim, fixture.agent_a, "obsolete failure")
            .await?
    );
    assert!(
        fixture
            .store
            .cancel(&retired_repair.id, "deferred E2E-only rerun")
            .await?
    );
    assert!(
        !fixture
            .store
            .retry_failed_main_task(
                &retired_repair.id,
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            )
            .await?,
        "policy-retired failed generations must not be rearmed"
    );
    verify_reused_failed_parent(fixture, exhausted).await
}

async fn verify_reused_failed_parent(
    fixture: &StoreFixture<'_>,
    exhausted: &EnqueueTask,
) -> anyhow::Result<()> {
    let mut reused_failed_parent = crate::task(
        format!("reused-failed-parent-{}", fixture.suffix),
        Vec::new(),
    )?;
    reused_failed_parent.kind = "main-repair".into();
    fixture.store.enqueue(&reused_failed_parent).await?;
    let reused_failed_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert!(
        fixture
            .store
            .block(
                &reused_failed_claim,
                fixture.agent_a,
                exhausted,
                "reuse an already exhausted blocker",
            )
            .await?
    );
    let mut rows = fixture
        .graph
        .execute(
            query(
                "MATCH (task:Task {id: $id})
                 RETURN task.status AS status",
            )
            .param("id", reused_failed_parent.id.as_str()),
        )
        .await?;
    assert_eq!(
        rows.next()
            .await?
            .context("reused failed parent must have a status row")?
            .get::<String>("status")?,
        "FAILED"
    );
    assert!(
        fixture
            .store
            .retry_failed_main_task(
                &reused_failed_parent.id,
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            )
            .await?,
        "a repaired release must rearm the failed blocker chain"
    );
    let recovered_blocker =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(recovered_blocker.id, exhausted.id);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &recovered_blocker,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "sandbox dependency repaired",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    let recovered_parent =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(recovered_parent.id, reused_failed_parent.id);
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &recovered_parent,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "dependent repair complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(())
}
