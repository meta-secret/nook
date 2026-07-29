use std::env;

use anyhow::Context;
use hive::model::{
    ActivityKind, ActivityLease, AgentId, Artifact, ClaimOutcome, CompletionArtifact, EnqueueTask,
    TaskActivity, TaskId, TaskTrigger,
};
use hive::observer::AlertKind;
use hive::{Neo4jTaskStore, TaskStore};
use neo4rs::{ConfigBuilder, Graph, query};
use uuid::Uuid;

#[path = "neo4j_store/rearm.rs"]
mod rearm;
#[path = "neo4j_store/schema.rs"]
mod schema;

fn task(id: String, dependencies: Vec<TaskId>) -> anyhow::Result<EnqueueTask> {
    Ok(EnqueueTask {
        id: TaskId::new(id)?,
        kind: "integration".to_owned(),
        trigger: TaskTrigger::ManualCli,
        prompt: "Exercise the production task store".to_owned(),
        source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
        priority: 0,
        max_attempts: 3,
        dependencies,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn production_store_enforces_claims_dependencies_and_stale_leases() -> anyhow::Result<()> {
    let Ok(uri) = env::var("HIVE_NEO4J_TEST_URI") else {
        return Ok(());
    };
    let username = env::var("HIVE_NEO4J_TEST_USERNAME").unwrap_or_else(|_| "neo4j".to_owned());
    let password = env::var("HIVE_NEO4J_TEST_PASSWORD")?;
    let store = Neo4jTaskStore::connect(&uri, &username, &password).await?;
    store.migrate().await?;
    let graph = Graph::connect(
        ConfigBuilder::default()
            .uri(&uri)
            .user(&username)
            .password(&password)
            .db("neo4j")
            .build()?,
    )
    .await?;
    graph.run(query("MATCH (node) DETACH DELETE node")).await?;

    let suffix = Uuid::new_v4().simple().to_string();
    let dependency = task(format!("dependency-{suffix}"), Vec::new())?;
    let dependent = task(format!("dependent-{suffix}"), vec![dependency.id.clone()])?;
    store.enqueue(&dependency).await?;
    let mut mismatched = task(format!("mismatched-{suffix}"), vec![dependency.id.clone()])?;
    mismatched.source_commit = "fedcba9876543210fedcba9876543210fedcba98".to_owned();
    assert!(
        store.enqueue(&mismatched).await.is_err(),
        "one dependency DAG must target exactly one repository revision"
    );
    store.enqueue(&dependent).await?;
    assert!(
        store.enqueue(&dependency).await.is_err(),
        "duplicate enqueue must not reset task state"
    );

    let agent_a = AgentId::new(format!("agent-a-{suffix}"))?;
    let agent_b = AgentId::new(format!("agent-b-{suffix}"))?;
    let agent_c = AgentId::new(format!("agent-c-{suffix}"))?;
    for agent in [&agent_a, &agent_b, &agent_c] {
        store.register_agent(agent, agent.as_str()).await?;
    }

    let dependency_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(dependency_claim.id, dependency.id);
    assert!(
        store.claim(&agent_b, 300).await?.is_idle(),
        "dependent task must remain blocked"
    );
    let artifact = Artifact {
        id: format!("artifact-{suffix}"),
        kind: "git-patch".to_owned(),
        uri: format!("hive://artifact/artifact-{suffix}"),
        digest: "sha256:fixture".to_owned(),
        content: "diff --git a/file b/file".to_owned(),
    };
    assert!(
        store
            .complete(
                &dependency_claim,
                &agent_a,
                false,
                "dependency complete",
                &CompletionArtifact::Produced(artifact.clone()),
            )
            .await?
    );
    let mut promoted_rows = graph
        .execute(
            query(
                "MATCH (task:Task {id: $task_id})
                 RETURN task.status AS status,
                        task.blocked_reason IS NULL AS cleared_blocked_reason",
            )
            .param("task_id", dependent.id.as_str()),
        )
        .await?;
    let promoted = promoted_rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("promoted dependent row was missing"))?;
    assert_eq!(promoted.get::<String>("status")?, "READY");
    assert!(
        promoted.get::<bool>("cleared_blocked_reason")?,
        "promoted tasks must not retain dependency-failure classification"
    );
    let mut artifact_rows = graph
        .execute(
            query(
                "MATCH (:Attempt {id: $attempt_id})-[:PRODUCED]->(artifact:Artifact)
                 RETURN artifact.digest AS digest, artifact.content AS content",
            )
            .param("attempt_id", dependency_claim.attempt_id.as_str()),
        )
        .await?;
    let artifact_row = artifact_rows
        .next()
        .await?
        .context("completed dependency must produce an artifact row")?;
    assert_eq!(artifact_row.get::<String>("digest")?, artifact.digest);
    assert_eq!(artifact_row.get::<String>("content")?, artifact.content);

    let (claim_b_result, claim_c_result) =
        tokio::join!(store.claim(&agent_b, 300), store.claim(&agent_c, 300));
    let claim_b = claim_b_result?;
    let claim_c = claim_c_result?;
    let (stale_claim, stale_agent, retry_agent) = match (claim_b, claim_c) {
        (ClaimOutcome::Claimed(claim), ClaimOutcome::NoTask) => (claim, &agent_b, &agent_c),
        (ClaimOutcome::NoTask, ClaimOutcome::Claimed(claim)) => (claim, &agent_c, &agent_b),
        _ => return Err(anyhow::anyhow!("only one worker may win a claim")),
    };
    assert_eq!(
        stale_claim.dependency_artifacts,
        vec![artifact.clone()],
        "a dependent task must receive the completed dependency patch"
    );
    for sequence in 0..205 {
        assert!(
            store
                .record_activity(
                    &ActivityLease::from(stale_claim.as_ref()),
                    stale_agent,
                    &TaskActivity {
                        kind: ActivityKind::Action,
                        message: "activity.command_running".to_owned(),
                        detail: format!("bounded command {sequence}"),
                    },
                )
                .await?
        );
    }
    let mut activity_count_rows = graph
        .execute(
            query(
                "MATCH (:TaskActivity)-[:FOR_TASK]->(:Task {id: $task_id})
                 RETURN count(*) AS count",
            )
            .param("task_id", stale_claim.id.as_str()),
        )
        .await?;
    let activity_count = activity_count_rows
        .next()
        .await?
        .context("claimed task must have an activity count row")?
        .get::<i64>("count")?;
    assert_eq!(activity_count, 200, "durable activity must remain bounded");
    let snapshot = store.observer_snapshot("en").await?;
    let observed = snapshot
        .tasks
        .iter()
        .find(|task| task.id == stale_claim.id.as_str())
        .context("observer snapshot must contain the claimed task")?;
    assert_eq!(observed.trigger, "Manual dispatch · Hive CLI");
    assert_eq!(observed.activity.len(), 100);
    assert!(
        observed
            .activity
            .iter()
            .all(|activity| activity.message == "Running repository command")
    );

    graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", dependent.id.as_str()),
        )
        .await?;
    let retry_claim = store.claim(retry_agent, 300).await?.into_claimed()?;
    assert_eq!(retry_claim.attempt_number, 2);
    assert!(
        !store
            .heartbeat(&stale_claim.id, stale_agent, &stale_claim.lease_token, 300,)
            .await?
    );
    assert!(
        !store
            .record_activity(
                &ActivityLease::from(stale_claim.as_ref()),
                stale_agent,
                &TaskActivity {
                    kind: ActivityKind::Error,
                    message: "activity.execution_stopped".to_owned(),
                    detail: String::new(),
                },
            )
            .await?
    );
    assert!(
        !store
            .complete(
                &stale_claim,
                stale_agent,
                false,
                "stale completion",
                &CompletionArtifact::NotProduced
            )
            .await?
    );
    let dependent_artifact = Artifact {
        id: format!("dependent-artifact-{suffix}"),
        kind: "git-patch".to_owned(),
        uri: format!("hive://artifact/dependent-artifact-{suffix}"),
        digest: "sha256:dependent-fixture".to_owned(),
        content: "diff --git a/dependent b/dependent".to_owned(),
    };
    assert!(
        store
            .complete(
                &retry_claim,
                retry_agent,
                false,
                "retry complete",
                &CompletionArtifact::Produced(dependent_artifact.clone()),
            )
            .await?
    );
    let descendant = task(format!("descendant-{suffix}"), vec![dependent.id.clone()])?;
    store.enqueue(&descendant).await?;
    let descendant_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(
        descendant_claim.dependency_artifacts,
        vec![artifact.clone(), dependent_artifact],
        "transitive dependency patches must be returned in ancestor-first order"
    );
    assert!(
        store
            .complete(
                &descendant_claim,
                &agent_a,
                false,
                "descendant complete",
                &CompletionArtifact::NotProduced
            )
            .await?
    );

    let left = task(format!("left-{suffix}"), vec![dependency.id.clone()])?;
    let right = task(format!("right-{suffix}"), vec![dependency.id.clone()])?;
    store.enqueue(&left).await?;
    store.enqueue(&right).await?;
    for (branch, branch_artifact_id) in [
        (&left, format!("left-artifact-{suffix}")),
        (&right, format!("right-artifact-{suffix}")),
    ] {
        let claim = store.claim(&agent_a, 300).await?.into_claimed()?;
        assert_eq!(claim.id, branch.id);
        let branch_artifact = Artifact {
            id: branch_artifact_id.clone(),
            kind: "git-patch".to_owned(),
            uri: format!("hive://artifact/{branch_artifact_id}"),
            digest: format!("sha256:{branch_artifact_id}"),
            content: format!("diff --git a/{branch_artifact_id} b/{branch_artifact_id}"),
        };
        assert!(
            store
                .complete(
                    &claim,
                    &agent_a,
                    false,
                    "branch complete",
                    &CompletionArtifact::Produced(branch_artifact.clone())
                )
                .await?
        );
    }
    let diamond = task(
        format!("diamond-{suffix}"),
        vec![left.id.clone(), right.id.clone()],
    )?;
    store.enqueue(&diamond).await?;
    let diamond_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(
        diamond_claim
            .dependency_artifacts
            .iter()
            .filter(|candidate| candidate.id == artifact.id)
            .count(),
        1,
        "a shared ancestor artifact must be materialized only once"
    );
    assert!(
        store
            .complete(
                &diamond_claim,
                &agent_a,
                false,
                "diamond complete",
                &CompletionArtifact::NotProduced
            )
            .await?
    );

    rearm::verify_release_retry(&store, &graph, &agent_a, &suffix).await?;

    let mut rows = graph
        .execute(
            query(
                "MATCH (attempt:Attempt)-[:FOR_TASK]->(task:Task {id: $id})
                 RETURN attempt.status AS status
                 ORDER BY attempt.number",
            )
            .param("id", dependent.id.as_str()),
        )
        .await?;
    let mut statuses = Vec::new();
    while let Some(row) = rows.next().await? {
        statuses.push(row.get::<String>("status")?);
    }
    assert_eq!(statuses, ["EXPIRED", "COMPLETED"]);

    let rollout = task(format!("rollout-{suffix}"), Vec::new())?;
    store.enqueue(&rollout).await?;
    let interrupted = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(store.release(&interrupted, &agent_a).await?);
    let resumed = store.claim(&agent_b, 300).await?.into_claimed()?;
    assert_eq!(resumed.attempt_number, 1);
    assert!(
        store
            .complete(
                &resumed,
                &agent_b,
                false,
                "rollout recovery complete",
                &CompletionArtifact::NotProduced
            )
            .await?
    );
    let mut rollout_rows = graph
        .execute(
            query(
                "MATCH (attempt:Attempt)-[:FOR_TASK]->(task:Task {id: $id})
                 RETURN attempt.status AS status
                 ORDER BY attempt.status",
            )
            .param("id", rollout.id.as_str()),
        )
        .await?;
    let mut rollout_statuses = Vec::new();
    while let Some(row) = rollout_rows.next().await? {
        rollout_statuses.push(row.get::<String>("status")?);
    }
    assert_eq!(rollout_statuses, ["COMPLETED", "INTERRUPTED"]);

    let original = task(format!("blocked-original-{suffix}"), Vec::new())?;
    let mut blocker = task(format!("blocker-{suffix}"), Vec::new())?;
    blocker.priority = 100;
    store.enqueue(&original).await?;
    let original_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .block(
                &original_claim,
                &agent_a,
                &blocker,
                "requires a prerequisite repair",
            )
            .await?
    );
    let blocker_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(blocker_claim.id, blocker.id);
    assert!(
        store
            .complete(
                &blocker_claim,
                &agent_a,
                false,
                "blocker complete",
                &CompletionArtifact::NotProduced
            )
            .await?
    );
    let resumed_original = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(resumed_original.id, original.id);
    assert_eq!(resumed_original.attempt_number, 1);
    assert!(
        store
            .complete(
                &resumed_original,
                &agent_a,
                false,
                "original complete",
                &CompletionArtifact::NotProduced
            )
            .await?
    );

    rearm::verify_completed_parent_gate(&store, &graph, &agent_a, &blocker, &suffix).await?;
    rearm::verify_block_serializes_with_retirement(&store, &graph, &agent_a, &suffix).await?;
    rearm::verify_enqueue_serializes_with_retirement(&store, &graph, &agent_a, &suffix).await?;

    let cancelled_root = task(format!("cancelled-root-{suffix}"), Vec::new())?;
    let cancelled_blocker = task(format!("cancelled-blocker-{suffix}"), Vec::new())?;
    store.enqueue(&cancelled_root).await?;
    let cancelled_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .block(
                &cancelled_claim,
                &agent_a,
                &cancelled_blocker,
                "obsolete prerequisite repair",
            )
            .await?
    );
    assert!(
        store
            .cancel(&cancelled_root.id, "deferred E2E-only rerun")
            .await?
    );
    assert!(store.claim(&agent_a, 300).await?.is_idle());

    let reused = task(format!("reused-blocker-original-{suffix}"), Vec::new())?;
    store.enqueue(&reused).await?;
    let reused_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .block(
                &reused_claim,
                &agent_a,
                &blocker,
                "requires the already-completed prerequisite repair",
            )
            .await?
    );
    let mut reused_state_rows = graph
        .execute(
            query(
                "MATCH (task:Task {id: $id})
                 RETURN task.status AS status,
                        task.blocked_reason IS NULL AS cleared_blocked_reason",
            )
            .param("id", reused.id.as_str()),
        )
        .await?;
    let reused_state = reused_state_rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("completed-blocker reuse row was missing"))?;
    assert_eq!(reused_state.get::<String>("status")?, "READY");
    assert!(reused_state.get::<bool>("cleared_blocked_reason")?);
    let resumed_reused = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(resumed_reused.id, reused.id);
    assert_eq!(resumed_reused.attempt_number, 1);
    assert!(
        store
            .complete(
                &resumed_reused,
                &agent_a,
                false,
                "completed reused-blocker task",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );

    let cycle_root = task(format!("cycle-root-{suffix}"), Vec::new())?;
    let cycle_dependent = task(
        format!("cycle-dependent-{suffix}"),
        vec![cycle_root.id.clone()],
    )?;
    store.enqueue(&cycle_root).await?;
    store.enqueue(&cycle_dependent).await?;
    let cycle_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    let mut existing_dependent = cycle_dependent.clone();
    existing_dependent.dependencies.clear();
    assert!(
        !store
            .block(
                &cycle_claim,
                &agent_a,
                &existing_dependent,
                "must reject a dependency cycle",
            )
            .await?
    );
    assert!(
        store
            .complete(
                &cycle_claim,
                &agent_a,
                false,
                "cycle root complete",
                &CompletionArtifact::NotProduced
            )
            .await?
    );
    let cycle_dependent_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .complete(
                &cycle_dependent_claim,
                &agent_a,
                false,
                "cycle dependent complete",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );

    let mut exhausted = task(format!("exhausted-{suffix}"), Vec::new())?;
    exhausted.max_attempts = 1;
    let stranded = task(
        format!("exhausted-dependent-{suffix}"),
        vec![exhausted.id.clone()],
    )?;
    store.enqueue(&exhausted).await?;
    store.enqueue(&stranded).await?;
    let exhausted_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .fail(&exhausted_claim, &agent_a, "terminal failure")
            .await?
    );
    let mut failed_rows = graph
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
    let mut failed_statuses = Vec::new();
    while let Some(row) = failed_rows.next().await? {
        failed_statuses.push((row.get::<String>("id")?, row.get::<String>("status")?));
    }
    assert_eq!(failed_statuses.len(), 2);
    assert!(
        failed_statuses.iter().all(|(_, status)| status == "FAILED"),
        "terminal dependency failure must propagate to every blocked descendant"
    );
    let dependency_alert = store
        .observer_snapshot("en")
        .await?
        .alerts
        .into_iter()
        .find(|alert| alert.task_id == stranded.id.as_str())
        .ok_or_else(|| anyhow::anyhow!("propagated dependency alert was missing"))?;
    assert_eq!(dependency_alert.kind, AlertKind::DependencyFailed);
    let late_dependent = task(
        format!("late-failed-dependent-{suffix}"),
        vec![exhausted.id.clone()],
    )?;
    store.enqueue(&late_dependent).await?;
    let late_dependency_alert = store
        .observer_snapshot("en")
        .await?
        .alerts
        .into_iter()
        .find(|alert| alert.task_id == late_dependent.id.as_str())
        .ok_or_else(|| anyhow::anyhow!("late dependency alert was missing"))?;
    assert_eq!(late_dependency_alert.kind, AlertKind::DependencyFailed);

    let mut repair = task(format!("main-failure-{suffix}"), Vec::new())?;
    repair.kind = "main-repair".to_owned();
    repair.max_attempts = 1;
    store.enqueue(&repair).await?;
    let ClaimOutcome::Claimed(repair_claim) = store.claim(&agent_a, 300).await? else {
        return Err(anyhow::anyhow!("Main repair must be available"));
    };
    assert!(
        store
            .fail(&repair_claim, &agent_a, "invalid structured output schema")
            .await?
    );
    let status = store.queue_status(200).await?;
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
    assert!(
        store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await?
    );
    assert!(
        !store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await?,
        "one release must not grant an unbounded retry budget"
    );
    for attempt_number in 2..=4 {
        let ClaimOutcome::Claimed(retried_claim) = store.claim(&agent_a, 300).await? else {
            return Err(anyhow::anyhow!("retried Main repair must be available"));
        };
        assert_eq!(retried_claim.id, repair.id);
        assert_eq!(retried_claim.attempt_number, attempt_number);
        assert!(
            store
                .fail(
                    &retried_claim,
                    &agent_a,
                    &format!("repair attempt {attempt_number} failed"),
                )
                .await?
        );
    }
    let status = store.queue_status(200).await?;
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
    assert!(
        !store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await?,
        "an exhausted recovery budget must not be rearmed by the same release"
    );
    assert!(
        store
            .retry_failed_main_task(
                &repair.id,
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            )
            .await?,
        "a distinct repaired release must receive one bounded budget"
    );
    let release_b_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(release_b_claim.id, repair.id);
    assert_eq!(release_b_claim.attempt_number, 5);
    assert!(
        store
            .complete(
                &release_b_claim,
                &agent_a,
                false,
                "platform repaired",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );

    let mut retired_repair = task(format!("retired-main-failure-{suffix}"), Vec::new())?;
    retired_repair.kind = "main-repair".to_owned();
    retired_repair.max_attempts = 1;
    store.enqueue(&retired_repair).await?;
    let retired_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .fail(&retired_claim, &agent_a, "obsolete failure")
            .await?
    );
    assert!(
        store
            .cancel(&retired_repair.id, "deferred E2E-only rerun")
            .await?
    );
    assert!(
        !store
            .retry_failed_main_task(
                &retired_repair.id,
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            )
            .await?,
        "policy-retired failed generations must not be rearmed"
    );

    let mut reused_failed_parent = task(format!("reused-failed-parent-{suffix}"), Vec::new())?;
    reused_failed_parent.kind = "main-repair".to_owned();
    store.enqueue(&reused_failed_parent).await?;
    let reused_failed_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(
        store
            .block(
                &reused_failed_claim,
                &agent_a,
                &exhausted,
                "reuse an already exhausted blocker",
            )
            .await?
    );
    let mut reused_failed_rows = graph
        .execute(
            query(
                "MATCH (task:Task {id: $id})
                 RETURN task.status AS status",
            )
            .param("id", reused_failed_parent.id.as_str()),
        )
        .await?;
    assert_eq!(
        reused_failed_rows
            .next()
            .await?
            .context("reused failed parent must have a status row")?
            .get::<String>("status")?,
        "FAILED"
    );
    assert!(
        store
            .retry_failed_main_task(
                &reused_failed_parent.id,
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            )
            .await?,
        "a repaired release must rearm the failed blocker chain"
    );
    let recovered_blocker = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(recovered_blocker.id, exhausted.id);
    assert!(
        store
            .complete(
                &recovered_blocker,
                &agent_a,
                false,
                "sandbox dependency repaired",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );
    let recovered_parent = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(recovered_parent.id, reused_failed_parent.id);
    assert!(
        store
            .complete(
                &recovered_parent,
                &agent_a,
                false,
                "dependent repair complete",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );

    let expired_block_parent = task(format!("expired-block-parent-{suffix}"), Vec::new())?;
    let expired_blocker = task(format!("expired-blocker-{suffix}"), Vec::new())?;
    store.enqueue(&expired_block_parent).await?;
    let expired_block_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", expired_block_parent.id.as_str()),
        )
        .await?;
    assert!(
        !store
            .block(
                &expired_block_claim,
                &agent_a,
                &expired_blocker,
                "stale worker must not mutate dependencies",
            )
            .await?
    );
    graph
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

    let mut lease_exhausted = task(format!("lease-exhausted-{suffix}"), Vec::new())?;
    lease_exhausted.max_attempts = 1;
    let lease_stranded = task(
        format!("lease-exhausted-dependent-{suffix}"),
        vec![lease_exhausted.id.clone()],
    )?;
    store.enqueue(&lease_exhausted).await?;
    store.enqueue(&lease_stranded).await?;
    let lease_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(lease_claim.id, lease_exhausted.id);
    graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", lease_exhausted.id.as_str()),
        )
        .await?;
    assert!(store.claim(&agent_b, 300).await?.is_idle());
    let mut lease_failed_rows = graph
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
    let mut lease_failed_statuses = Vec::new();
    while let Some(row) = lease_failed_rows.next().await? {
        lease_failed_statuses.push(row.get::<String>("status")?);
    }
    assert_eq!(lease_failed_statuses.len(), 2);
    assert!(
        lease_failed_statuses
            .iter()
            .all(|status| status == "FAILED"),
        "final lease failure must propagate to every descendant: {lease_failed_statuses:?}"
    );

    let cancelling = task(format!("cancelling-{suffix}"), Vec::new())?;
    store.enqueue(&cancelling).await?;
    let cancelling_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(cancelling_claim.id, cancelling.id);
    assert!(store.cancel(&cancelling.id, "superseded").await?);
    assert!(
        !store
            .heartbeat(
                &cancelling_claim.id,
                &agent_a,
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
            .acknowledge_cancellation(&cancelling_claim, &agent_a)
            .await?
    );
    assert!(store.cancellation_targets(&cancelling.id).await?.is_empty());

    let forced = task(format!("forced-cancellation-{suffix}"), Vec::new())?;
    store.enqueue(&forced).await?;
    let prior_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert!(store.fail(&prior_claim, &agent_a, "prior failure").await?);
    let current_claim = store.claim(&agent_b, 300).await?.into_claimed()?;
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
            .complete(
                &current_claim,
                &agent_b,
                false,
                "late",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );

    schema::verify_migrations(&store, &graph).await?;
    Ok(())
}
