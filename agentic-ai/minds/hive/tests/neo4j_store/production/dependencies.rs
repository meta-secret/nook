use anyhow::Context;
use hive::TaskStore;
use hive::model::{ActivityKind, ActivityLease, AgentId, Artifact, ClaimOutcome, ClaimedTask};
use hive::model::{CompletionArtifact, EnqueueTask, TaskActivity};
use neo4rs::query;

use super::StoreFixture;

pub(super) async fn verify(fixture: &StoreFixture<'_>) -> anyhow::Result<()> {
    let dependency_fixture = prepare_dependency(fixture).await?;
    let stale = claim_stale_dependency(fixture, &dependency_fixture).await?;
    let retry = complete_stale_dependency(fixture, &dependency_fixture, &stale).await?;
    verify_transitive_artifacts(fixture, &dependency_fixture, &retry).await?;
    verify_diamond_artifacts(fixture, &dependency_fixture).await?;
    crate::rearm::verify_release_retry(
        fixture.store,
        fixture.graph,
        fixture.agent_a,
        fixture.suffix,
    )
    .await?;
    verify_release_statuses(fixture, &dependency_fixture.dependent).await
}

struct DependencyFixture {
    dependency: EnqueueTask,
    dependent: EnqueueTask,
    artifact: Artifact,
}

struct StaleDependency {
    claim: ClaimedTask,
    stale_agent: AgentId,
    retry_agent: AgentId,
}

struct RetriedDependency {
    artifact: Artifact,
}

async fn prepare_dependency(fixture: &StoreFixture<'_>) -> anyhow::Result<DependencyFixture> {
    let dependency = crate::task(format!("dependency-{}", fixture.suffix), Vec::new())?;
    let dependent = crate::task(
        format!("dependent-{}", fixture.suffix),
        vec![dependency.id.clone()],
    )?;
    fixture.store.enqueue(&dependency).await?;
    let mut mismatched = crate::task(
        format!("mismatched-{}", fixture.suffix),
        vec![dependency.id.clone()],
    )?;
    "fedcba9876543210fedcba9876543210fedcba98".clone_into(&mut mismatched.source_commit);
    assert!(
        fixture.store.enqueue(&mismatched).await.is_err(),
        "one dependency DAG must target exactly one repository revision"
    );
    fixture.store.enqueue(&dependent).await?;
    assert!(
        fixture.store.enqueue(&dependency).await.is_err(),
        "duplicate enqueue must not reset task state"
    );
    let dependency_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(dependency_claim.id, dependency.id);
    assert!(
        fixture.store.claim(fixture.agent_b, 300).await?.is_idle(),
        "dependent task must remain blocked"
    );
    let artifact = Artifact {
        id: format!("artifact-{}", fixture.suffix),
        kind: "git-patch".to_owned(),
        uri: format!("hive://artifact/artifact-{}", fixture.suffix),
        digest: "sha256:fixture".to_owned(),
        content: "diff --git a/file b/file".to_owned(),
    };
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &dependency_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "dependency complete",
                artifact: &CompletionArtifact::Produced(artifact.clone()),
            })
            .await?
    );
    verify_promoted_dependency(fixture, &dependent, &dependency_claim, &artifact).await?;
    Ok(DependencyFixture {
        dependency,
        dependent,
        artifact,
    })
}

async fn verify_promoted_dependency(
    fixture: &StoreFixture<'_>,
    dependent: &EnqueueTask,
    dependency_claim: &ClaimedTask,
    artifact: &Artifact,
) -> anyhow::Result<()> {
    let mut promoted_rows = fixture
        .graph
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
    let mut artifact_rows = fixture
        .graph
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
    Ok(())
}

async fn claim_stale_dependency(
    fixture: &StoreFixture<'_>,
    dependency: &DependencyFixture,
) -> anyhow::Result<StaleDependency> {
    let (first_claim_result, second_claim_result) = tokio::join!(
        fixture.store.claim(fixture.agent_b, 300),
        fixture.store.claim(fixture.agent_c, 300)
    );
    let claim_b = first_claim_result?;
    let claim_c = second_claim_result?;
    let (claim, stale_agent, retry_agent) = match (claim_b, claim_c) {
        (ClaimOutcome::Claimed(claim), ClaimOutcome::NoTask) => {
            (claim, fixture.agent_b.clone(), fixture.agent_c.clone())
        }
        (ClaimOutcome::NoTask, ClaimOutcome::Claimed(claim)) => {
            (claim, fixture.agent_c.clone(), fixture.agent_b.clone())
        }
        _ => return Err(anyhow::anyhow!("only one worker may win a claim")),
    };
    assert_eq!(
        claim.dependency_artifacts,
        vec![dependency.artifact.clone()],
        "a dependent task must receive the completed dependency patch"
    );
    for sequence in 0..205 {
        assert!(
            fixture
                .store
                .record_activity(
                    &ActivityLease::from(claim.as_ref()),
                    &stale_agent,
                    &TaskActivity {
                        kind: ActivityKind::Action,
                        message: "activity.command_running".to_owned(),
                        detail: format!("bounded command {sequence}"),
                    },
                )
                .await?
        );
    }
    let mut activity_count_rows = fixture
        .graph
        .execute(
            query(
                "MATCH (:TaskActivity)-[:FOR_TASK]->(:Task {id: $task_id})
                 RETURN count(*) AS count",
            )
            .param("task_id", claim.id.as_str()),
        )
        .await?;
    let activity_count = activity_count_rows
        .next()
        .await?
        .context("claimed task must have an activity count row")?
        .get::<i64>("count")?;
    assert_eq!(activity_count, 200, "durable activity must remain bounded");
    let snapshot = fixture.store.observer_snapshot("en").await?;
    let observed = snapshot
        .tasks
        .iter()
        .find(|task| task.id == claim.id.as_str())
        .context("observer snapshot must contain the claimed task")?;
    assert_eq!(observed.trigger, "Manual dispatch · Hive CLI");
    assert_eq!(observed.activity.len(), 100);
    assert!(
        observed
            .activity
            .iter()
            .all(|activity| activity.message == "Running repository command")
    );
    Ok(StaleDependency {
        claim: *claim,
        stale_agent,
        retry_agent,
    })
}

async fn complete_stale_dependency(
    fixture: &StoreFixture<'_>,
    dependency: &DependencyFixture,
    stale: &StaleDependency,
) -> anyhow::Result<RetriedDependency> {
    fixture
        .graph
        .run(
            query(
                "MATCH (task:Task {id: $id})
                 SET task.lease_until = timestamp() - 1",
            )
            .param("id", dependency.dependent.id.as_str()),
        )
        .await?;
    let retry_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(&stale.retry_agent, 300).await?)?;
    assert_eq!(retry_claim.attempt_number, 2);
    assert!(
        !fixture
            .store
            .heartbeat(
                &stale.claim.id,
                &stale.stale_agent,
                &stale.claim.lease_token,
                300,
            )
            .await?
    );
    assert!(
        !fixture
            .store
            .record_activity(
                &ActivityLease::from(&stale.claim),
                &stale.stale_agent,
                &TaskActivity {
                    kind: ActivityKind::Error,
                    message: "activity.execution_stopped".to_owned(),
                    detail: String::new(),
                },
            )
            .await?
    );
    assert!(
        !fixture
            .store
            .complete(hive::model::Completion {
                task: &stale.claim,
                agent_id: &stale.stale_agent,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "stale completion",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    let artifact = Artifact {
        id: format!("dependent-artifact-{}", fixture.suffix),
        kind: "git-patch".to_owned(),
        uri: format!("hive://artifact/dependent-artifact-{}", fixture.suffix),
        digest: "sha256:dependent-fixture".to_owned(),
        content: "diff --git a/dependent b/dependent".to_owned(),
    };
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &retry_claim,
                agent_id: &stale.retry_agent,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "retry complete",
                artifact: &CompletionArtifact::Produced(artifact.clone()),
            })
            .await?
    );
    Ok(RetriedDependency { artifact })
}

async fn verify_transitive_artifacts(
    fixture: &StoreFixture<'_>,
    dependency: &DependencyFixture,
    retry: &RetriedDependency,
) -> anyhow::Result<()> {
    let descendant = crate::task(
        format!("descendant-{}", fixture.suffix),
        vec![dependency.dependent.id.clone()],
    )?;
    fixture.store.enqueue(&descendant).await?;
    let descendant_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(
        descendant_claim.dependency_artifacts,
        vec![dependency.artifact.clone(), retry.artifact.clone()],
        "transitive dependency patches must be returned in ancestor-first order"
    );
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &descendant_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "descendant complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(())
}

async fn verify_diamond_artifacts(
    fixture: &StoreFixture<'_>,
    dependency: &DependencyFixture,
) -> anyhow::Result<()> {
    let left = crate::task(
        format!("left-{}", fixture.suffix),
        vec![dependency.dependency.id.clone()],
    )?;
    let right = crate::task(
        format!("right-{}", fixture.suffix),
        vec![dependency.dependency.id.clone()],
    )?;
    fixture.store.enqueue(&left).await?;
    fixture.store.enqueue(&right).await?;
    for (branch, branch_artifact_id) in [
        (&left, format!("left-artifact-{}", fixture.suffix)),
        (&right, format!("right-artifact-{}", fixture.suffix)),
    ] {
        let claim =
            hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
        assert_eq!(claim.id, branch.id);
        let branch_artifact = Artifact {
            id: branch_artifact_id.clone(),
            kind: "git-patch".to_owned(),
            uri: format!("hive://artifact/{branch_artifact_id}"),
            digest: format!("sha256:{branch_artifact_id}"),
            content: format!("diff --git a/{branch_artifact_id} b/{branch_artifact_id}"),
        };
        assert!(
            fixture
                .store
                .complete(hive::model::Completion {
                    task: &claim,
                    agent_id: fixture.agent_a,
                    relevance: hive::model::CompletionRelevance::Current,
                    summary: "branch complete",
                    artifact: &CompletionArtifact::Produced(branch_artifact),
                })
                .await?
        );
    }
    let diamond = crate::task(
        format!("diamond-{}", fixture.suffix),
        vec![left.id.clone(), right.id.clone()],
    )?;
    fixture.store.enqueue(&diamond).await?;
    let diamond_claim =
        hive::model::ClaimedTask::try_from(fixture.store.claim(fixture.agent_a, 300).await?)?;
    assert_eq!(
        diamond_claim
            .dependency_artifacts
            .iter()
            .filter(|candidate| candidate.id == dependency.artifact.id)
            .count(),
        1,
        "a shared ancestor artifact must be materialized only once"
    );
    assert!(
        fixture
            .store
            .complete(hive::model::Completion {
                task: &diamond_claim,
                agent_id: fixture.agent_a,
                relevance: hive::model::CompletionRelevance::Current,
                summary: "diamond complete",
                artifact: &CompletionArtifact::NotProduced,
            })
            .await?
    );
    Ok(())
}

async fn verify_release_statuses(
    fixture: &StoreFixture<'_>,
    dependent: &EnqueueTask,
) -> anyhow::Result<()> {
    let mut rows = fixture
        .graph
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
    Ok(())
}
