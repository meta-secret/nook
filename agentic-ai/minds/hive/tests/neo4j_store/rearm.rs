use anyhow::Context as _;
use hive::model::{AgentId, ClaimedTask, CompletionArtifact, EnqueueTask, TaskId, TaskTrigger};
use hive::observer::ObserverStore;
use hive::{Neo4jTaskStore, TaskStore};
use neo4rs::{Graph, query};
use tokio::time::{Duration, sleep, timeout};

fn task(id: String, dependencies: Vec<TaskId>) -> EnqueueTask {
    EnqueueTask {
        id: TaskId::new(id).expect("valid task id"),
        kind: "integration".to_owned(),
        trigger: TaskTrigger::ManualCli,
        prompt: "Exercise obsolete dependency rearming".to_owned(),
        source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
        priority: 0,
        max_attempts: 3,
        dependencies,
    }
}

async fn complete(
    store: &Neo4jTaskStore,
    task: &ClaimedTask,
    agent: &AgentId,
    obsolete: bool,
    summary: &str,
) -> anyhow::Result<()> {
    assert!(
        store
            .complete(
                task,
                agent,
                obsolete,
                summary,
                &CompletionArtifact::NotProduced,
            )
            .await?
    );
    Ok(())
}

pub async fn verify_completed_parent_gate(
    store: &Neo4jTaskStore,
    graph: &Graph,
    agent: &AgentId,
    completed_parent: &EnqueueTask,
    suffix: &str,
) -> anyhow::Result<()> {
    let retired_descendant_id = format!("retired-descendant-{suffix}");
    graph
        .run(
            query(
                "MATCH (parent:Task {id: $parent_id})
                 CREATE (retired:Task {
                   id: $retired_id,
                   kind: 'blocker',
                   trigger_kind: 'manual-cli',
                   prompt: 'Retired descendant fixture',
                   status: 'COMPLETED',
                   obsolete: true,
                   source_commit: parent.source_commit,
                   priority: 0,
                   attempt_count: 1,
                   max_attempts: 3,
                   last_retry_release: '',
                   version: 0,
                   created_at: timestamp(),
                   updated_at: timestamp()
                 })
                 MERGE (parent)-[:DEPENDS_ON]->(retired)",
            )
            .param("parent_id", completed_parent.id.as_str())
            .param("retired_id", retired_descendant_id.as_str()),
        )
        .await?;
    let consumer = task(
        format!("completed-parent-consumer-{suffix}"),
        vec![completed_parent.id.clone()],
    );
    store.enqueue(&consumer).await?;
    let consumer_claim = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(consumer_claim.id, consumer.id);
    let mut retired_rows = graph
        .execute(
            query(
                "MATCH (retired:Task {id: $retired_id})
                 RETURN retired.status AS status, retired.obsolete AS obsolete",
            )
            .param("retired_id", retired_descendant_id.as_str()),
        )
        .await?;
    let retired_row = retired_rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("retired descendant fixture was missing"))?;
    assert_eq!(retired_row.get::<String>("status")?, "COMPLETED");
    assert!(retired_row.get::<bool>("obsolete")?);
    complete(
        store,
        &consumer_claim,
        agent,
        false,
        "normally completed parent remained satisfied",
    )
    .await?;
    graph
        .run(
            query("MATCH (retired:Task {id: $retired_id}) DETACH DELETE retired")
                .param("retired_id", retired_descendant_id),
        )
        .await?;
    Ok(())
}

pub async fn verify_block_serializes_with_retirement(
    store: &Neo4jTaskStore,
    graph: &Graph,
    agent: &AgentId,
    suffix: &str,
) -> anyhow::Result<()> {
    let mut blocker = task(
        format!("concurrent-retirement-blocker-{suffix}"),
        Vec::new(),
    );
    blocker.kind = "blocker".to_owned();
    let owner = task(format!("concurrent-retirement-owner-{suffix}"), Vec::new());
    store.enqueue(&blocker).await?;
    store.enqueue(&owner).await?;
    let blocker_claim = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(blocker_claim.id, blocker.id);
    complete(
        store,
        &blocker_claim,
        agent,
        false,
        "blocker initially completed",
    )
    .await?;
    let owner_claim = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(owner_claim.id, owner.id);

    let mut retirement = graph.start_txn().await?;
    retirement
        .run(
            query(
                "MATCH (blocker:Task {id: $blocker_id})
                 SET blocker.obsolete = true,
                     blocker.version = blocker.version + 1",
            )
            .param("blocker_id", blocker.id.as_str()),
        )
        .await?;
    let blocking_store = store.clone();
    let blocking_agent = agent.clone();
    let blocking_task = owner_claim.clone();
    let blocking_definition = blocker.clone();
    let blocked = tokio::spawn(async move {
        blocking_store
            .block(
                &blocking_task,
                &blocking_agent,
                &blocking_definition,
                "retirement committed while the edge was attaching",
            )
            .await
    });
    sleep(Duration::from_millis(100)).await;
    retirement.commit().await?;
    assert!(
        timeout(Duration::from_secs(5), blocked)
            .await
            .map_err(|_| anyhow::anyhow!(
                "blocker attachment remained locked after retirement"
            ))???
    );
    let rearmed = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(rearmed.id, blocker.id);
    assert_eq!(rearmed.attempt_number, 2);
    complete(
        store,
        &rearmed,
        agent,
        false,
        "concurrently retired blocker repaired",
    )
    .await?;
    let resumed_owner = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(resumed_owner.id, owner.id);
    complete(
        store,
        &resumed_owner,
        agent,
        false,
        "owner resumed after concurrent retirement",
    )
    .await
}

pub async fn verify_release_retry(
    store: &Neo4jTaskStore,
    graph: &Graph,
    agent: &AgentId,
    suffix: &str,
) -> anyhow::Result<()> {
    let mut blocker = task(format!("retry-obsolete-blocker-{suffix}"), Vec::new());
    blocker.kind = "blocker".to_owned();
    let mut owner = task(
        format!("main-failure-retry-obsolete-{suffix}"),
        vec![blocker.id.clone()],
    );
    owner.kind = "main-repair".to_owned();
    owner.max_attempts = 1;
    store.enqueue(&blocker).await?;
    store.enqueue(&owner).await?;
    let blocker_claim = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(blocker_claim.id, blocker.id);
    complete(
        store,
        &blocker_claim,
        agent,
        false,
        "prerequisite initially completed",
    )
    .await?;
    let owner_claim = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(owner_claim.id, owner.id);
    assert!(
        store
            .fail(&owner_claim, agent, "delivery failed after retirement")
            .await?
    );
    let mut retirement = graph.start_txn().await?;
    retirement
        .run(
            query(
                "MATCH (blocker:Task {id: $blocker_id})
                 SET blocker.obsolete = true,
                     blocker.max_attempts = 9,
                     blocker.version = blocker.version + 1",
            )
            .param("blocker_id", blocker.id.as_str()),
        )
        .await?;
    let retry_store = store.clone();
    let retry_owner = owner.id.clone();
    let retried = tokio::spawn(async move {
        retry_store
            .retry_failed_main_task(
                &retry_owner,
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            )
            .await
    });
    sleep(Duration::from_millis(100)).await;
    retirement.commit().await?;
    assert!(
        timeout(Duration::from_secs(5), retried)
            .await
            .map_err(|_| anyhow::anyhow!("retry remained locked after retirement"))???
    );
    let mut budget_rows = graph
        .execute(
            query(
                "MATCH (blocker:Task {id: $blocker_id})
                 RETURN blocker.max_attempts AS max_attempts",
            )
            .param("blocker_id", blocker.id.as_str()),
        )
        .await?;
    assert_eq!(
        budget_rows
            .next()
            .await?
            .context("rearmed obsolete blocker must remain observable")?
            .get::<i64>("max_attempts")?,
        9,
        "obsolete rearming must preserve a larger operator-granted budget"
    );
    let rearmed_blocker = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(
        rearmed_blocker.id, blocker.id,
        "release-scoped retry must rearm an obsolete dependency before its owner"
    );
    assert_eq!(rearmed_blocker.attempt_number, 2);
    complete(
        store,
        &rearmed_blocker,
        agent,
        false,
        "retired prerequisite repaired for retry",
    )
    .await?;
    let resumed_owner = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(resumed_owner.id, owner.id);
    complete(
        store,
        &resumed_owner,
        agent,
        false,
        "release-scoped retry completed",
    )
    .await
}

pub async fn verify_blocked_release_retry(
    store: &Neo4jTaskStore,
    graph: &Graph,
    agent: &AgentId,
    suffix: &str,
) -> anyhow::Result<()> {
    let leaf = task(format!("stalled-leaf-{suffix}"), Vec::new());
    let ready = task(format!("stalled-ready-{suffix}"), Vec::new());
    let parent = task(format!("stalled-parent-{suffix}"), vec![leaf.id.clone()]);
    let mut repair = task(
        format!("stalled-main-failure-{suffix}"),
        vec![parent.id.clone(), ready.id.clone()],
    );
    repair.kind = "main-repair".to_owned();
    repair.max_attempts = 1;
    store.enqueue(&leaf).await?;
    store.enqueue(&ready).await?;
    store.enqueue(&parent).await?;
    store.enqueue(&repair).await?;
    graph
        .run(
            query(
                "MATCH (leaf:Task {id: $leaf_id}),
                       (ready:Task {id: $ready_id}),
                       (parent:Task {id: $parent_id}),
                       (repair:Task {id: $repair_id})
                 SET leaf.status = 'BLOCKED',
                     leaf.blocked_reason = 'historical platform prerequisite',
                     leaf.max_attempts = 9,
                     ready.attempt_count = 2,
                     ready.max_attempts = 3,
                     repair.status = 'BLOCKED',
                     repair.blocked_reason = 'blocked chain exhausted'
                 CREATE (attempt:Attempt {
                   id: $attempt_id,
                   status: 'FAILED',
                   error: 'stale pre-retry failure',
                   started_at: timestamp() - 2,
                   completed_at: timestamp() - 1
                 })-[:FOR_TASK]->(parent)",
            )
            .param("leaf_id", leaf.id.as_str())
            .param("ready_id", ready.id.as_str())
            .param("parent_id", parent.id.as_str())
            .param("repair_id", repair.id.as_str())
            .param("attempt_id", format!("stale-parent-attempt-{suffix}")),
        )
        .await?;
    assert!(
        store
            .retry_failed_main_task(
                &repair.id,
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            )
            .await?,
        "release retry must revive a chain whose deepest leaf is blocked"
    );
    let mut retry_rows = graph
        .execute(
            query(
                "MATCH (leaf:Task {id: $leaf_id}),
                       (ready:Task {id: $ready_id}),
                       (parent:Task {id: $parent_id})
                 RETURN leaf.max_attempts AS leaf_max_attempts,
                        ready.max_attempts AS ready_max_attempts,
                        parent.status AS parent_status,
                        parent.blocked_reason AS parent_blocked_reason",
            )
            .param("leaf_id", leaf.id.as_str())
            .param("ready_id", ready.id.as_str())
            .param("parent_id", parent.id.as_str()),
        )
        .await?;
    let retry_row = retry_rows
        .next()
        .await?
        .context("blocked retry state must remain observable")?;
    assert_eq!(retry_row.get::<i64>("leaf_max_attempts")?, 9);
    assert_eq!(
        retry_row.get::<i64>("ready_max_attempts")?,
        5,
        "a reachable READY member must receive three post-release attempts"
    );
    assert_eq!(retry_row.get::<String>("parent_status")?, "BLOCKED");
    assert!(
        !retry_row.get::<String>("parent_blocked_reason")?.is_empty(),
        "a member that remains blocked must retain an operator-visible reason"
    );
    let observed_parent = store
        .observer_task_value(parent.id.as_str(), "en")
        .await?
        .context("retried blocked parent must be visible to the observer")?;
    assert_eq!(
        observed_parent
            .get("latest_error")
            .and_then(serde_json::Value::as_str),
        Some("waiting for retried dependencies"),
        "Control Center must prefer the current blocked reason over a stale attempt error"
    );
    let revived_leaf = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(revived_leaf.id, leaf.id);
    assert!(
        !store
            .retry_failed_main_task(
                &repair.id,
                "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            )
            .await?,
        "release retry must refuse a graph with an active attempt"
    );
    let mut release_rows = graph
        .execute(
            query(
                "MATCH (repair:Task {id: $repair_id})
                 RETURN repair.last_retry_release AS last_retry_release",
            )
            .param("repair_id", repair.id.as_str()),
        )
        .await?;
    assert_eq!(
        release_rows
            .next()
            .await?
            .context("active repair root must remain observable")?
            .get::<String>("last_retry_release")?,
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "refusing an active graph must not consume the new release"
    );
    complete(
        store,
        &revived_leaf,
        agent,
        false,
        "historical prerequisite is obsolete",
    )
    .await?;
    let revived_ready = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(revived_ready.id, ready.id);
    assert_eq!(revived_ready.attempt_number, 3);
    complete(
        store,
        &revived_ready,
        agent,
        false,
        "ready prerequisite completed within the renewed budget",
    )
    .await?;
    let revived_parent = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(revived_parent.id, parent.id);
    complete(
        store,
        &revived_parent,
        agent,
        false,
        "stalled dependency reconciled",
    )
    .await?;
    let revived_repair = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(revived_repair.id, repair.id);
    complete(
        store,
        &revived_repair,
        agent,
        false,
        "stalled Main repair resumed",
    )
    .await
}

pub async fn verify_enqueue_serializes_with_retirement(
    store: &Neo4jTaskStore,
    graph: &Graph,
    agent: &AgentId,
    suffix: &str,
) -> anyhow::Result<()> {
    let mut blocker = task(format!("enqueue-retirement-blocker-{suffix}"), Vec::new());
    blocker.kind = "blocker".to_owned();
    store.enqueue(&blocker).await?;
    let blocker_claim = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(blocker_claim.id, blocker.id);
    complete(
        store,
        &blocker_claim,
        agent,
        false,
        "direct dependency initially completed",
    )
    .await?;
    let consumer = task(
        format!("enqueue-retirement-consumer-{suffix}"),
        vec![blocker.id.clone()],
    );
    let mut retirement = graph.start_txn().await?;
    retirement
        .run(
            query(
                "MATCH (blocker:Task {id: $blocker_id})
                 SET blocker.obsolete = true,
                     blocker.version = blocker.version + 1",
            )
            .param("blocker_id", blocker.id.as_str()),
        )
        .await?;
    let enqueue_store = store.clone();
    let enqueued_consumer = consumer.clone();
    let enqueued = tokio::spawn(async move { enqueue_store.enqueue(&enqueued_consumer).await });
    sleep(Duration::from_millis(100)).await;
    retirement.commit().await?;
    timeout(Duration::from_secs(5), enqueued)
        .await
        .map_err(|_| anyhow::anyhow!("enqueue remained locked after retirement"))???;
    let rearmed = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(rearmed.id, blocker.id);
    assert_eq!(rearmed.attempt_number, 2);
    complete(
        store,
        &rearmed,
        agent,
        false,
        "concurrently retired direct dependency repaired",
    )
    .await?;
    let resumed_consumer = store.claim(agent, 300).await?.into_claimed()?;
    assert_eq!(resumed_consumer.id, consumer.id);
    complete(
        store,
        &resumed_consumer,
        agent,
        false,
        "direct consumer resumed after concurrent retirement",
    )
    .await
}
