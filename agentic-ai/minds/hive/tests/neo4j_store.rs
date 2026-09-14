#![allow(
    clippy::absolute_paths,
    reason = "integration-test submodules identify model contracts explicitly"
)]

use hive::model::{
    AgentId, BootstrapEvidence, CompletionArtifact, EnqueueTask, FeatureBranch, GitSha, TaskId,
    TaskTrigger,
};
use hive::{Neo4jTaskStore, TaskStore};
use neo4rs::{Graph, query};

#[path = "neo4j_store/cancellation.rs"]
mod cancellation;
#[path = "neo4j_store/production/mod.rs"]
mod production;
#[path = "neo4j_store/rearm.rs"]
mod rearm;
#[path = "neo4j_store/schema.rs"]
mod schema;

fn task(id: String, dependencies: Vec<TaskId>) -> anyhow::Result<EnqueueTask> {
    Ok(EnqueueTask {
        id: TaskId::try_from(id)?,
        kind: "integration".into(),
        trigger: TaskTrigger::ManualCli,
        prompt: "Exercise the production task store".to_owned(),
        source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
        bootstrap_evidence: Some(BootstrapEvidence {
            origin_main_sha: GitSha::try_from("0123456789abcdef0123456789abcdef01234567")?,
            pinned_local_dev_sha: GitSha::try_from("123456789abcdef0123456789abcdef012345678")?,
            feature_branch: FeatureBranch::try_from("codex/repair-cache")?,
        }),
        priority: 0,
        max_attempts: 3,
        dependencies,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn production_store_enforces_claims_dependencies_and_stale_leases() -> anyhow::Result<()> {
    production::run().await
}
