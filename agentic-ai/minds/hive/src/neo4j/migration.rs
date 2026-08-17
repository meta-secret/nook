use crate::HiveContext;
use neo4rs::{Graph, query};

const CONSTRAINTS: &[&str] = &[
    "CREATE CONSTRAINT hive_task_id IF NOT EXISTS FOR (node:Task) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_agent_id IF NOT EXISTS FOR (node:Agent) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_attempt_id IF NOT EXISTS FOR (node:Attempt) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_artifact_id IF NOT EXISTS FOR (node:Artifact) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_activity_id IF NOT EXISTS FOR (node:TaskActivity) REQUIRE node.id IS UNIQUE",
    "CREATE INDEX hive_task_claim IF NOT EXISTS FOR (node:Task) ON (node.status, node.priority, node.created_at)",
    "CREATE INDEX hive_activity_timeline IF NOT EXISTS FOR (node:TaskActivity) ON (node.created_at)",
];
const LATEST_SCHEMA_VERSION: i64 = 9;

pub(super) async fn migrate(graph: &Graph) -> crate::HiveResult<()> {
    let mut rows = graph
        .execute(query(
            "MATCH (migration:HiveSchemaMigration)
                 RETURN max(migration.version) AS version",
        ))
        .await?;
    let installed_version = rows
        .next()
        .await?
        .and_then(|row| row.get::<i64>("version").ok())
        .unwrap_or(0);
    if installed_version > LATEST_SCHEMA_VERSION {
        return Err(crate::error::HiveError::message(format!(
            "Hive graph schema {installed_version} is newer than supported version {LATEST_SCHEMA_VERSION}"
        )));
    }
    if installed_version == 1 {
        let mut rows = graph
            .execute(query(
                "MATCH (task:Task)
                     WHERE task.source_commit IS NULL
                     RETURN count(task) AS legacy_tasks",
            ))
            .await?;
        let legacy_tasks = rows
            .next()
            .await?
            .and_then(|row| row.get::<i64>("legacy_tasks").ok())
            .unwrap_or(0);
        if legacy_tasks > 0 {
            return Err(crate::error::HiveError::message(format!(
                "Hive schema 1 contains {legacy_tasks} task(s) without source_commit; \
                     drain or remove those legacy tasks before upgrading to schema 2"
            )));
        }
    }
    if installed_version < 3 {
        graph
            .run(query(
                "MATCH (task:Task)
                     WHERE task.manual_retry_used IS NULL
                     SET task.manual_retry_used = false",
            ))
            .await
            .hive_context("failed to initialize schema-3 manual retry state")?;
    }
    if installed_version < 4 {
        graph
            .run(query(
                "MATCH (task:Task)
                     SET task.last_retry_release =
                       coalesce(task.last_retry_release, '')
                     REMOVE task.manual_retry_used",
            ))
            .await
            .hive_context("failed to initialize schema-4 release-scoped retry state")?;
    }
    if installed_version < 7 {
        graph
            .run(query(
                "MATCH (task:Task)
                     OPTIONAL MATCH (activity:TaskActivity)-[:FOR_TASK]->(task)
                     WITH task, max(activity.created_at) AS latest_activity_at
                     WHERE latest_activity_at IS NOT NULL
                     SET task.latest_activity_at = latest_activity_at",
            ))
            .await
            .hive_context("failed to backfill schema-7 latest activity state")?;
    }
    if installed_version < 8 {
        graph
            .run(query(
                "MATCH (task:Task)
                     WHERE task.obsolete IS NULL
                     SET task.obsolete = false",
            ))
            .await
            .hive_context("failed to backfill schema-8 task retirement state")?;
        graph
            .run(query(
                "MATCH (attempt:Attempt)
                     WHERE attempt.obsolete IS NULL
                     SET attempt.obsolete = false",
            ))
            .await
            .hive_context("failed to backfill schema-8 attempt retirement state")?;
    }
    if installed_version < 9 {
        graph
            .run(query(
                "MATCH (blocker:Task {kind: 'blocker'})-[edge:DEPENDS_ON]->(dependency:Task)
                     WHERE dependency.status = 'COMPLETED'
                     WITH blocker, dependency, edge,
                          blocker.status AS prior_status
                     MERGE (blocker)-[:INCLUDES_ARTIFACT_FROM]->(dependency)
                     DELETE edge
                     WITH DISTINCT blocker, prior_status
                     SET blocker.status = CASE
                           WHEN prior_status = 'BLOCKED'
                             AND NOT EXISTS {
                               MATCH (blocker)-[:DEPENDS_ON]->(:Task)
                             }
                             THEN 'READY'
                           ELSE prior_status
                         END,
                         blocker.blocked_reason = CASE
                           WHEN prior_status = 'BLOCKED'
                             AND NOT EXISTS {
                               MATCH (blocker)-[:DEPENDS_ON]->(:Task)
                             }
                             THEN null
                           ELSE blocker.blocked_reason
                         END,
                         blocker.updated_at = timestamp(),
                         blocker.version = coalesce(blocker.version, 0) + 1",
            ))
            .await
            .hive_context("failed to preserve and detach schema-9 blocker dependencies")?;
    }
    for statement in CONSTRAINTS {
        graph
            .run(query(statement))
            .await
            .with_hive_context(|| format!("failed to apply graph migration: {statement}"))?;
    }
    graph
        .run(
            query(
                "MERGE (migration:HiveSchemaMigration {version: $version})
                     ON CREATE SET migration.applied_at = timestamp()",
            )
            .param("version", LATEST_SCHEMA_VERSION),
        )
        .await?;
    Ok(())
}
