use super::{AgentId, CompletionArtifact, Graph, Neo4jTaskStore, TaskStore, query, task};

pub(super) struct CancellationScenario<'a> {
    pub(super) store: &'a Neo4jTaskStore,
    pub(super) graph: &'a Graph,
    pub(super) agent_a: &'a AgentId,
    pub(super) agent_b: &'a AgentId,
    pub(super) suffix: &'a str,
}

pub(super) async fn exercise_cancellation(
    scenario: CancellationScenario<'_>,
) -> anyhow::Result<()> {
    let CancellationScenario {
        store,
        graph,
        agent_a,
        agent_b,
        suffix,
    } = scenario;
    let cancelling = task(format!("cancelling-{suffix}"), Vec::new())?;
    store.enqueue(&cancelling).await?;
    let cancelling_claim = hive::model::ClaimedTask::try_from(store.claim(agent_a, 300).await?)?;
    assert_eq!(cancelling_claim.id, cancelling.id);
    assert!(store.cancel(&cancelling.id, "superseded").await?);
    assert!(
        !store
            .heartbeat(
                &cancelling_claim.id,
                agent_a,
                &cancelling_claim.lease_token,
                300,
            )
            .await?
    );
    let targets = store.cancellation_targets(&cancelling.id).await?;
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].task_id, cancelling.id);
    assert_eq!(targets[0].pod_name, agent_a.as_str());
    assert!(
        store
            .acknowledge_cancellation(&cancelling_claim, agent_a)
            .await?
    );
    assert!(store.cancellation_targets(&cancelling.id).await?.is_empty());

    let forced = task(format!("forced-cancellation-{suffix}"), Vec::new())?;
    store.enqueue(&forced).await?;
    let prior_claim = hive::model::ClaimedTask::try_from(store.claim(agent_a, 300).await?)?;
    assert!(store.fail(&prior_claim, agent_a, "prior failure").await?);
    let current_claim = hive::model::ClaimedTask::try_from(store.claim(agent_b, 300).await?)?;
    assert!(store.cancel(&forced.id, "superseded").await?);
    assert!(store.finalize_cancellation(&forced.id).await?);
    let mut forced_rows = graph
        .execute(
            query(
                "MATCH (task:Task {id: $id})<-[:FOR_TASK]-(attempt:Attempt)
                 RETURN attempt.status AS status
                 ORDER BY attempt.number",
            )
            .param("id", forced.id.as_str()),
        )
        .await?;
    let mut forced_statuses = Vec::new();
    while let Some(row) = forced_rows.next().await? {
        forced_statuses.push(row.get::<String>("status")?);
    }
    assert_eq!(forced_statuses, ["FAILED", "CANCELLED"]);
    assert!(
        !store
            .complete(hive::model::Completion {
                task: &current_claim,
                agent_id: agent_b,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "late",
                artifact: &CompletionArtifact::NotProduced
            })
            .await?
    );

    Ok(())
}
