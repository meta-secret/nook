use std::env;

use hive::model::{
    ActivityKind, ActivityLease, AgentId, Artifact, ClaimOutcome, ClaimedTask, CompletionArtifact,
    EnqueueTask, TaskActivity, TaskId, TaskTrigger,
};
use hive::observer::AlertKind;
use hive::{Neo4jTaskStore, TaskStore};
use neo4rs::{ConfigBuilder, Graph, query};
use uuid::Uuid;

fn task(id: String, dependencies: Vec<TaskId>) -> EnqueueTask {
    EnqueueTask {
        id: TaskId::new(id).expect("valid task id"),
        kind: "integration".to_owned(),
        trigger: TaskTrigger::ManualCli,
        prompt: "Exercise the production task store".to_owned(),
        source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
        priority: 0,
        max_attempts: 3,
        dependencies,
    }
}

async fn complete_without_artifact(
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
    let dependency = task(format!("dependency-{suffix}"), Vec::new());
    let dependent = task(format!("dependent-{suffix}"), vec![dependency.id.clone()]);
    store
        .enqueue(&dependency)
        .await
        .expect("enqueue dependency");
    let mut mismatched = task(format!("mismatched-{suffix}"), vec![dependency.id.clone()]);
    mismatched.source_commit = "fedcba9876543210fedcba9876543210fedcba98".to_owned();
    assert!(
        store.enqueue(&mismatched).await.is_err(),
        "one dependency DAG must target exactly one repository revision"
    );
    store.enqueue(&dependent).await.expect("enqueue dependent");
    assert!(
        store.enqueue(&dependency).await.is_err(),
        "duplicate enqueue must not reset task state"
    );

    let agent_a = AgentId::new(format!("agent-a-{suffix}")).expect("valid agent");
    let agent_b = AgentId::new(format!("agent-b-{suffix}")).expect("valid agent");
    let agent_c = AgentId::new(format!("agent-c-{suffix}")).expect("valid agent");
    for agent in [&agent_a, &agent_b, &agent_c] {
        store
            .register_agent(agent, agent.as_str())
            .await
            .expect("register agent");
    }

    let dependency_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim dependency")
        .into_claimed()
        .expect("dependency available");
    assert_eq!(dependency_claim.id, dependency.id);
    assert!(
        store
            .claim(&agent_b, 300)
            .await
            .expect("blocked claim")
            .is_idle(),
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
            .await
            .expect("complete dependency")
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
        .await
        .expect("query durable artifact");
    let artifact_row = artifact_rows
        .next()
        .await
        .expect("read durable artifact")
        .expect("artifact row");
    assert_eq!(
        artifact_row
            .get::<String>("digest")
            .expect("artifact digest"),
        artifact.digest
    );
    assert_eq!(
        artifact_row
            .get::<String>("content")
            .expect("artifact content"),
        artifact.content
    );

    let (claim_b_result, claim_c_result) =
        tokio::join!(store.claim(&agent_b, 300), store.claim(&agent_c, 300));
    let claim_b = claim_b_result.expect("agent b claim");
    let claim_c = claim_c_result.expect("agent c claim");
    let (stale_claim, stale_agent, retry_agent) = match (claim_b, claim_c) {
        (ClaimOutcome::Claimed(claim), ClaimOutcome::NoTask) => (claim, &agent_b, &agent_c),
        (ClaimOutcome::NoTask, ClaimOutcome::Claimed(claim)) => (claim, &agent_c, &agent_b),
        _ => panic!("only one worker may win a claim"),
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
                .await
                .expect("record durable activity")
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
        .await
        .expect("query bounded task activity");
    let activity_count = activity_count_rows
        .next()
        .await
        .expect("read activity count")
        .expect("activity count row")
        .get::<i64>("count")
        .expect("activity count");
    assert_eq!(activity_count, 200, "durable activity must remain bounded");
    let snapshot = store.observer_snapshot("en").await?;
    let observed = snapshot
        .tasks
        .iter()
        .find(|task| task.id == stale_claim.id.as_str())
        .expect("claimed task in observer projection");
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
        .await
        .expect("expire lease");
    let retry_claim = store
        .claim(retry_agent, 300)
        .await
        .expect("retry claim")
        .into_claimed()
        .expect("expired task is claimable");
    assert_eq!(retry_claim.attempt_number, 2);
    assert!(
        !store
            .heartbeat(&stale_claim.id, stale_agent, &stale_claim.lease_token, 300,)
            .await
            .expect("stale heartbeat")
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
            .await
            .expect("stale activity")
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
            .await
            .expect("stale completion")
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
            .await
            .expect("current completion")
    );
    let descendant = task(format!("descendant-{suffix}"), vec![dependent.id.clone()]);
    store
        .enqueue(&descendant)
        .await
        .expect("enqueue descendant");
    let descendant_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim descendant")
        .into_claimed()
        .expect("descendant available");
    assert_eq!(
        descendant_claim.dependency_artifacts,
        vec![artifact.clone(), dependent_artifact],
        "transitive dependency patches must be returned in ancestor-first order"
    );
    complete_without_artifact(
        &store,
        &descendant_claim,
        &agent_a,
        false,
        "descendant complete",
    )
    .await?;

    let left = task(format!("left-{suffix}"), vec![dependency.id.clone()]);
    let right = task(format!("right-{suffix}"), vec![dependency.id.clone()]);
    store.enqueue(&left).await.expect("enqueue left branch");
    store.enqueue(&right).await.expect("enqueue right branch");
    for (branch, branch_artifact_id) in [
        (&left, format!("left-artifact-{suffix}")),
        (&right, format!("right-artifact-{suffix}")),
    ] {
        let claim = store
            .claim(&agent_a, 300)
            .await
            .expect("claim branch")
            .into_claimed()
            .expect("branch available");
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
                .await
                .expect("complete branch")
        );
    }
    let diamond = task(
        format!("diamond-{suffix}"),
        vec![left.id.clone(), right.id.clone()],
    );
    store.enqueue(&diamond).await.expect("enqueue diamond");
    let diamond_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim diamond")
        .into_claimed()
        .expect("diamond available");
    assert_eq!(
        diamond_claim
            .dependency_artifacts
            .iter()
            .filter(|candidate| candidate.id == artifact.id)
            .count(),
        1,
        "a shared ancestor artifact must be materialized only once"
    );
    complete_without_artifact(&store, &diamond_claim, &agent_a, false, "diamond complete").await?;

    let mut rows = graph
        .execute(
            query(
                "MATCH (attempt:Attempt)-[:FOR_TASK]->(task:Task {id: $id})
                 RETURN attempt.status AS status
                 ORDER BY attempt.number",
            )
            .param("id", dependent.id.as_str()),
        )
        .await
        .expect("read attempts");
    let mut statuses = Vec::new();
    while let Some(row) = rows.next().await.expect("attempt row") {
        statuses.push(row.get::<String>("status").expect("attempt status"));
    }
    assert_eq!(statuses, ["EXPIRED", "COMPLETED"]);

    let rollout = task(format!("rollout-{suffix}"), Vec::new());
    store.enqueue(&rollout).await.expect("enqueue rollout task");
    let interrupted = store
        .claim(&agent_a, 300)
        .await
        .expect("claim rollout task")
        .into_claimed()
        .expect("rollout task available");
    assert!(
        store
            .release(&interrupted, &agent_a)
            .await
            .expect("release rollout task")
    );
    let resumed = store
        .claim(&agent_b, 300)
        .await
        .expect("reclaim rollout task")
        .into_claimed()
        .expect("released task available");
    assert_eq!(resumed.attempt_number, 1);
    complete_without_artifact(
        &store,
        &resumed,
        &agent_b,
        false,
        "rollout recovery complete",
    )
    .await?;
    let mut rollout_rows = graph
        .execute(
            query(
                "MATCH (attempt:Attempt)-[:FOR_TASK]->(task:Task {id: $id})
                 RETURN attempt.status AS status
                 ORDER BY attempt.status",
            )
            .param("id", rollout.id.as_str()),
        )
        .await
        .expect("read rollout attempts");
    let mut rollout_statuses = Vec::new();
    while let Some(row) = rollout_rows.next().await.expect("rollout attempt row") {
        rollout_statuses.push(row.get::<String>("status").expect("rollout status"));
    }
    assert_eq!(rollout_statuses, ["COMPLETED", "INTERRUPTED"]);

    let original = task(format!("blocked-original-{suffix}"), Vec::new());
    let mut blocker = task(format!("blocker-{suffix}"), Vec::new());
    blocker.priority = 100;
    store.enqueue(&original).await.expect("enqueue original");
    let original_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim original")
        .into_claimed()
        .expect("original available");
    assert!(
        store
            .block(
                &original_claim,
                &agent_a,
                &blocker,
                "requires a prerequisite repair",
            )
            .await
            .expect("persist blocker")
    );
    let blocker_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim blocker")
        .into_claimed()
        .expect("blocker available");
    assert_eq!(blocker_claim.id, blocker.id);
    complete_without_artifact(&store, &blocker_claim, &agent_a, false, "blocker complete").await?;
    let resumed_original = store
        .claim(&agent_a, 300)
        .await
        .expect("resume original")
        .into_claimed()
        .expect("original resumed");
    assert_eq!(resumed_original.id, original.id);
    assert_eq!(resumed_original.attempt_number, 1);
    complete_without_artifact(
        &store,
        &resumed_original,
        &agent_a,
        false,
        "original complete",
    )
    .await?;

    let cancelled_root = task(format!("cancelled-root-{suffix}"), Vec::new());
    let cancelled_blocker = task(format!("cancelled-blocker-{suffix}"), Vec::new());
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

    let reused = task(format!("reused-blocker-original-{suffix}"), Vec::new());
    store
        .enqueue(&reused)
        .await
        .expect("enqueue reused original");
    let reused_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim reused original")
        .into_claimed()
        .expect("reused original available");
    assert!(
        store
            .block(
                &reused_claim,
                &agent_a,
                &blocker,
                "requires the already-completed prerequisite repair",
            )
            .await
            .expect("persist completed blocker dependency")
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
    let resumed_reused = store
        .claim(&agent_a, 300)
        .await
        .expect("resume task with completed blocker")
        .into_claimed()
        .expect("task with completed blocker is ready");
    assert_eq!(resumed_reused.id, reused.id);
    assert_eq!(resumed_reused.attempt_number, 1);
    complete_without_artifact(
        &store,
        &resumed_reused,
        &agent_a,
        false,
        "completed reused-blocker task",
    )
    .await?;

    let cycle_root = task(format!("cycle-root-{suffix}"), Vec::new());
    let cycle_dependent = task(
        format!("cycle-dependent-{suffix}"),
        vec![cycle_root.id.clone()],
    );
    store
        .enqueue(&cycle_root)
        .await
        .expect("enqueue cycle root");
    store
        .enqueue(&cycle_dependent)
        .await
        .expect("enqueue cycle dependent");
    let cycle_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim cycle root")
        .into_claimed()
        .expect("cycle root available");
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
            .await
            .expect("reject dependency cycle")
    );
    complete_without_artifact(&store, &cycle_claim, &agent_a, false, "cycle root complete").await?;
    let cycle_dependent_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim cycle dependent")
        .into_claimed()
        .expect("cycle dependent available");
    complete_without_artifact(
        &store,
        &cycle_dependent_claim,
        &agent_a,
        false,
        "cycle dependent complete",
    )
    .await?;

    let mut exhausted = task(format!("exhausted-{suffix}"), Vec::new());
    exhausted.max_attempts = 1;
    let stranded = task(
        format!("exhausted-dependent-{suffix}"),
        vec![exhausted.id.clone()],
    );
    store
        .enqueue(&exhausted)
        .await
        .expect("enqueue exhausted task");
    store
        .enqueue(&stranded)
        .await
        .expect("enqueue exhausted dependent");
    let exhausted_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim exhausted task")
        .into_claimed()
        .expect("exhausted task available");
    assert!(
        store
            .fail(&exhausted_claim, &agent_a, "terminal failure")
            .await
            .expect("fail exhausted task")
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
        .await
        .expect("read propagated failures");
    let mut failed_statuses = Vec::new();
    while let Some(row) = failed_rows.next().await.expect("failed task row") {
        failed_statuses.push((
            row.get::<String>("id").expect("failed task id"),
            row.get::<String>("status").expect("failed task status"),
        ));
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
    );
    store.enqueue(&late_dependent).await?;
    let late_dependency_alert = store
        .observer_snapshot("en")
        .await?
        .alerts
        .into_iter()
        .find(|alert| alert.task_id == late_dependent.id.as_str())
        .ok_or_else(|| anyhow::anyhow!("late dependency alert was missing"))?;
    assert_eq!(late_dependency_alert.kind, AlertKind::DependencyFailed);

    let mut shared_blocker = task(format!("shared-blocker-{suffix}"), Vec::new());
    shared_blocker.kind = "blocker".to_owned();
    let mut owner_a = task(
        format!("main-failure-owner-a-{suffix}"),
        vec![shared_blocker.id.clone()],
    );
    owner_a.kind = "main-repair".to_owned();
    let mut owner_b = task(
        format!("main-failure-owner-b-{suffix}"),
        vec![shared_blocker.id.clone()],
    );
    owner_b.kind = "main-repair".to_owned();
    store.enqueue(&shared_blocker).await?;
    store.enqueue(&owner_b).await?;
    store.enqueue(&owner_a).await?;
    let shared_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(shared_claim.id, shared_blocker.id);
    assert_eq!(
        shared_claim.owning_repairs,
        vec![owner_a.id.clone(), owner_b.id.clone()],
        "a shared blocker must receive every active owning Main repair"
    );
    complete_without_artifact(
        &store,
        &shared_claim,
        &agent_a,
        true,
        "shared prerequisite complete",
    )
    .await?;
    for owner in [&owner_b, &owner_a] {
        let owner_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
        assert_eq!(owner_claim.id, owner.id);
        complete_without_artifact(
            &store,
            &owner_claim,
            &agent_a,
            false,
            "owning repair complete",
        )
        .await?;
    }

    let mut future_owner = task(format!("main-failure-future-owner-{suffix}"), Vec::new());
    future_owner.kind = "main-repair".to_owned();
    store.enqueue(&future_owner).await?;
    let future_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(future_claim.id, future_owner.id);
    assert!(
        store
            .block(
                &future_claim,
                &agent_a,
                &shared_blocker,
                "stable prerequisite became relevant again",
            )
            .await?
    );
    let rearmed_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(
        rearmed_claim.id, shared_blocker.id,
        "a future repair must rearm an obsolete blocker with the same stable id"
    );
    assert_eq!(rearmed_claim.owning_repairs, vec![future_owner.id.clone()]);
    complete_without_artifact(
        &store,
        &rearmed_claim,
        &agent_a,
        false,
        "shared prerequisite repaired for the future owner",
    )
    .await?;
    let resumed_future = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(resumed_future.id, future_owner.id);
    complete_without_artifact(
        &store,
        &resumed_future,
        &agent_a,
        false,
        "future owning repair complete",
    )
    .await?;

    let mut mixed_blocker = task(format!("mixed-owner-blocker-{suffix}"), Vec::new());
    mixed_blocker.kind = "blocker".to_owned();
    let mut mixed_repair = task(
        format!("main-failure-mixed-owner-{suffix}"),
        vec![mixed_blocker.id.clone()],
    );
    mixed_repair.kind = "main-repair".to_owned();
    let mixed_code = task(
        format!("mixed-owner-code-{suffix}"),
        vec![mixed_blocker.id.clone()],
    );
    store.enqueue(&mixed_blocker).await?;
    store.enqueue(&mixed_repair).await?;
    store.enqueue(&mixed_code).await?;
    let mixed_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(mixed_claim.id, mixed_blocker.id);
    assert!(
        mixed_claim.owning_repairs.is_empty(),
        "a non-Main dependent must disable obsolete blocker retirement"
    );
    complete_without_artifact(
        &store,
        &mixed_claim,
        &agent_a,
        false,
        "mixed-owner prerequisite actually resolved",
    )
    .await?;
    for owner in [&mixed_repair, &mixed_code] {
        let owner_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
        assert_eq!(owner_claim.id, owner.id);
        complete_without_artifact(
            &store,
            &owner_claim,
            &agent_a,
            false,
            "mixed owner complete",
        )
        .await?;
    }

    let mut genuine_blocker = task(format!("genuine-race-blocker-{suffix}"), Vec::new());
    genuine_blocker.kind = "blocker".to_owned();
    let mut genuine_owner = task(
        format!("main-failure-genuine-owner-{suffix}"),
        vec![genuine_blocker.id.clone()],
    );
    genuine_owner.kind = "main-repair".to_owned();
    store.enqueue(&genuine_blocker).await?;
    store.enqueue(&genuine_owner).await?;
    let genuine_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(genuine_claim.id, genuine_blocker.id);
    let mut genuine_late_owner = task(
        format!("main-failure-genuine-late-owner-{suffix}"),
        vec![genuine_blocker.id.clone()],
    );
    genuine_late_owner.kind = "main-repair".to_owned();
    store.enqueue(&genuine_late_owner).await?;
    let genuine_artifact = Artifact {
        id: format!("genuine-race-artifact-{suffix}"),
        kind: "git-patch".to_owned(),
        uri: format!("hive://artifact/genuine-race-artifact-{suffix}"),
        digest: "sha256:genuine-race".to_owned(),
        content: "diff --git a/prerequisite b/prerequisite".to_owned(),
    };
    assert!(
        store
            .complete(
                &genuine_claim,
                &agent_a,
                false,
                "genuine prerequisite fixed despite a late owner",
                &CompletionArtifact::Produced(genuine_artifact),
            )
            .await?,
        "ordinary artifact completion must survive an owner race"
    );
    for owner in [&genuine_owner, &genuine_late_owner] {
        let owner_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
        assert_eq!(owner_claim.id, owner.id);
        complete_without_artifact(
            &store,
            &owner_claim,
            &agent_a,
            false,
            "genuine owner complete",
        )
        .await?;
    }

    let mut raced_blocker = task(format!("late-owner-blocker-{suffix}"), Vec::new());
    raced_blocker.kind = "blocker".to_owned();
    let mut raced_parent = task(
        format!("late-owner-parent-blocker-{suffix}"),
        vec![raced_blocker.id.clone()],
    );
    raced_parent.kind = "blocker".to_owned();
    let mut original_owner = task(
        format!("main-failure-original-owner-{suffix}"),
        vec![raced_parent.id.clone()],
    );
    original_owner.kind = "main-repair".to_owned();
    store.enqueue(&raced_blocker).await?;
    store.enqueue(&raced_parent).await?;
    store.enqueue(&original_owner).await?;
    let raced_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(raced_claim.id, raced_blocker.id);
    assert_eq!(
        raced_claim.owning_repairs,
        vec![original_owner.id.clone()],
        "intermediate blockers are part of the same chain, not independent consumers"
    );
    let mut late_owner = task(
        format!("main-failure-late-owner-{suffix}"),
        vec![raced_blocker.id.clone()],
    );
    late_owner.kind = "main-repair".to_owned();
    store.enqueue(&late_owner).await?;
    assert!(
        !store
            .complete(
                &raced_claim,
                &agent_a,
                true,
                "stale owner snapshot",
                &CompletionArtifact::NotProduced,
            )
            .await?,
        "completion must reject a Main repair attached after claim"
    );
    assert!(store.release(&raced_claim, &agent_a).await?);
    let refreshed_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(refreshed_claim.id, raced_blocker.id);
    assert_eq!(
        refreshed_claim.owning_repairs,
        vec![late_owner.id.clone(), original_owner.id.clone()]
    );
    assert!(
        store
            .complete(
                &refreshed_claim,
                &agent_a,
                true,
                "fresh owner snapshot",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );
    let parent_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
    assert_eq!(parent_claim.id, raced_parent.id);
    assert!(
        store
            .complete(
                &parent_claim,
                &agent_a,
                true,
                "parent blocker complete",
                &CompletionArtifact::NotProduced,
            )
            .await?
    );
    for owner in [&original_owner, &late_owner] {
        let owner_claim = store.claim(&agent_a, 300).await?.into_claimed()?;
        assert_eq!(owner_claim.id, owner.id);
        assert!(
            store
                .complete(
                    &owner_claim,
                    &agent_a,
                    false,
                    "late owner complete",
                    &CompletionArtifact::NotProduced,
                )
                .await?
        );
    }

    let mut repair = task(format!("main-failure-{suffix}"), Vec::new());
    repair.kind = "main-repair".to_owned();
    repair.max_attempts = 1;
    store.enqueue(&repair).await.expect("enqueue Main repair");
    let ClaimOutcome::Claimed(repair_claim) =
        store.claim(&agent_a, 300).await.expect("claim Main repair")
    else {
        panic!("Main repair must be available");
    };
    assert!(
        store
            .fail(&repair_claim, &agent_a, "invalid structured output schema")
            .await
            .expect("exhaust Main repair")
    );
    let status = store
        .queue_status(200)
        .await
        .expect("inspect durable queue");
    let failed_repair = status
        .iter()
        .find(|task| task.id == repair.id.as_str())
        .expect("failed Main repair status");
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
            .await
            .expect("retry failed Main repair")
    );
    assert!(
        !store
            .retry_failed_main_task(
                &repair.id,
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .await
            .expect("refuse duplicate retry"),
        "one release must not grant an unbounded retry budget"
    );
    for attempt_number in 2..=4 {
        let ClaimOutcome::Claimed(retried_claim) = store
            .claim(&agent_a, 300)
            .await
            .expect("claim retried Main repair")
        else {
            panic!("retried Main repair must be available");
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
                .await
                .expect("fail retried Main repair")
        );
    }
    let status = store
        .queue_status(200)
        .await
        .expect("inspect retried Main repair attempts");
    let failed_repair = status
        .iter()
        .find(|task| task.id == repair.id.as_str())
        .expect("retried Main repair status");
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
            .await
            .expect("refuse a second budget on one release"),
        "an exhausted recovery budget must not be rearmed by the same release"
    );
    assert!(
        store
            .retry_failed_main_task(
                &repair.id,
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            )
            .await
            .expect("allow recovery after a new Hive repair release"),
        "a distinct repaired release must receive one bounded budget"
    );
    let release_b_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim repair on release b")
        .into_claimed()
        .expect("repair available on release b");
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
            .await
            .expect("complete repair on release b")
    );

    let mut retired_repair = task(format!("retired-main-failure-{suffix}"), Vec::new());
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

    let mut reused_failed_parent = task(format!("reused-failed-parent-{suffix}"), Vec::new());
    reused_failed_parent.kind = "main-repair".to_owned();
    store
        .enqueue(&reused_failed_parent)
        .await
        .expect("enqueue parent that discovers an exhausted blocker");
    let reused_failed_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim parent that discovers an exhausted blocker")
        .into_claimed()
        .expect("parent available");
    assert!(
        store
            .block(
                &reused_failed_claim,
                &agent_a,
                &exhausted,
                "reuse an already exhausted blocker",
            )
            .await
            .expect("bind exhausted blocker")
    );
    let mut reused_failed_rows = graph
        .execute(
            query(
                "MATCH (task:Task {id: $id})
                 RETURN task.status AS status",
            )
            .param("id", reused_failed_parent.id.as_str()),
        )
        .await
        .expect("read reused exhausted-blocker parent");
    assert_eq!(
        reused_failed_rows
            .next()
            .await
            .expect("read reused exhausted-blocker row")
            .expect("reused exhausted-blocker row")
            .get::<String>("status")
            .expect("reused exhausted-blocker status"),
        "FAILED"
    );
    assert!(
        store
            .retry_failed_main_task(
                &reused_failed_parent.id,
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            )
            .await
            .expect("recover failed dependency chain"),
        "a repaired release must rearm the failed blocker chain"
    );
    let recovered_blocker = store
        .claim(&agent_a, 300)
        .await
        .expect("claim recovered blocker")
        .into_claimed()
        .expect("recovered blocker available");
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
            .await
            .expect("complete recovered blocker")
    );
    let recovered_parent = store
        .claim(&agent_a, 300)
        .await
        .expect("claim recovered parent")
        .into_claimed()
        .expect("recovered parent available");
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
            .await
            .expect("complete recovered parent")
    );

    let expired_block_parent = task(format!("expired-block-parent-{suffix}"), Vec::new());
    let expired_blocker = task(format!("expired-blocker-{suffix}"), Vec::new());
    store
        .enqueue(&expired_block_parent)
        .await
        .expect("enqueue expired blocker parent");
    let expired_block_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim expired blocker parent")
        .into_claimed()
        .expect("expired blocker parent available");
    graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", expired_block_parent.id.as_str()),
        )
        .await
        .expect("expire blocker-reporting lease");
    assert!(
        !store
            .block(
                &expired_block_claim,
                &agent_a,
                &expired_blocker,
                "stale worker must not mutate dependencies",
            )
            .await
            .expect("reject blocker after lease expiry")
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
        .await
        .expect("retire expired blocker fixture");

    let mut lease_exhausted = task(format!("lease-exhausted-{suffix}"), Vec::new());
    lease_exhausted.max_attempts = 1;
    let lease_stranded = task(
        format!("lease-exhausted-dependent-{suffix}"),
        vec![lease_exhausted.id.clone()],
    );
    store
        .enqueue(&lease_exhausted)
        .await
        .expect("enqueue final-lease task");
    store
        .enqueue(&lease_stranded)
        .await
        .expect("enqueue final-lease dependent");
    let lease_claim = store
        .claim(&agent_a, 300)
        .await
        .expect("claim final-lease task")
        .into_claimed()
        .expect("final-lease task available");
    assert_eq!(lease_claim.id, lease_exhausted.id);
    graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", lease_exhausted.id.as_str()),
        )
        .await
        .expect("expire final lease");
    assert!(
        store
            .claim(&agent_b, 300)
            .await
            .expect("final lease expiry transition")
            .is_idle()
    );
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
        .await
        .expect("read final-lease propagated failures");
    let mut lease_failed_statuses = Vec::new();
    while let Some(row) = lease_failed_rows
        .next()
        .await
        .expect("final-lease failed row")
    {
        lease_failed_statuses.push(
            row.get::<String>("status")
                .expect("final-lease failed status"),
        );
    }
    assert_eq!(lease_failed_statuses.len(), 2);
    assert!(
        lease_failed_statuses
            .iter()
            .all(|status| status == "FAILED"),
        "final lease failure must propagate to every descendant: {lease_failed_statuses:?}"
    );

    let cancelling = task(format!("cancelling-{suffix}"), Vec::new());
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

    let forced = task(format!("forced-cancellation-{suffix}"), Vec::new());
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

    graph
        .run(query("MATCH (node) DETACH DELETE node"))
        .await
        .expect("clean isolated integration database");
    graph
        .run(query(
            "CREATE (:HiveSchemaMigration {version: 1})
             CREATE (:Task {id: 'legacy-without-source-commit', status: 'READY'})",
        ))
        .await
        .expect("create schema-1 fixture");
    assert!(
        store
            .migrate()
            .await
            .expect_err("schema-1 legacy tasks must block schema 2")
            .to_string()
            .contains("without source_commit")
    );
    graph
        .run(query("MATCH (node) DETACH DELETE node"))
        .await
        .expect("clean schema migration fixture");
    graph
        .run(query(
            "CREATE (:HiveSchemaMigration {version: 3})
             CREATE (:Task {
               id: 'schema-3-task',
               status: 'FAILED',
               manual_retry_used: true,
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (:Task {
               id: 'schema-4-rollback-task',
               status: 'FAILED',
               manual_retry_used: true,
               last_retry_release:
                 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (activity_task:Task {
               id: 'schema-6-activity-task',
               status: 'RUNNING',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (activity:TaskActivity {
               id: 'schema-6-activity',
               created_at: 123456
             })
             CREATE (activity)-[:FOR_TASK]->(activity_task)",
        ))
        .await
        .expect("create schema-3 fixture");
    store.migrate().await?;
    let mut schema_seven_rows = graph
        .execute(query(
            "MATCH (task:Task {id: 'schema-3-task'})
             MATCH (activity_task:Task {id: 'schema-6-activity-task'})
             MATCH (migration:HiveSchemaMigration {version: 7})
             RETURN task.last_retry_release AS last_retry_release,
                    task.manual_retry_used IS NULL AS removed_legacy_marker,
                    activity_task.latest_activity_at AS latest_activity_at,
                    migration.version AS version",
        ))
        .await?;
    let schema_seven = schema_seven_rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("schema-7 migration row was missing"))?;
    assert_eq!(
        schema_seven
            .get::<String>("last_retry_release")
            .expect("initialized release marker"),
        ""
    );
    assert!(
        schema_seven
            .get::<bool>("removed_legacy_marker")
            .expect("removed legacy marker")
    );
    assert_eq!(schema_seven.get::<i64>("latest_activity_at")?, 123456);
    assert_eq!(schema_seven.get::<i64>("version")?, 7);
    let mut rollback_marker_rows = graph
        .execute(query(
            "MATCH (task:Task {id: 'schema-4-rollback-task'})
             RETURN task.last_retry_release AS last_retry_release",
        ))
        .await
        .expect("read retained schema-4 rollback marker");
    assert_eq!(
        rollback_marker_rows
            .next()
            .await
            .expect("read schema-4 rollback row")
            .expect("schema-4 rollback row")
            .get::<String>("last_retry_release")
            .expect("retained schema-4 rollback marker"),
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    graph
        .run(query("MATCH (node) DETACH DELETE node"))
        .await
        .expect("clean schema-4 migration fixture");
    Ok(())
}
