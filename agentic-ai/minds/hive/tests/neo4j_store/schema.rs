use anyhow::Context;
use hive::{Neo4jTaskStore, TaskStore};
use neo4rs::{Graph, query};

pub async fn verify_migrations(store: &Neo4jTaskStore, graph: &Graph) -> anyhow::Result<()> {
    graph
        .run(query("MATCH (node) DETACH DELETE node"))
        .await
        .context("clean isolated integration database")?;
    graph
        .run(query(
            "CREATE (:HiveSchemaMigration {version: 1})
             CREATE (:Task {id: 'legacy-without-source-commit', status: 'READY'})",
        ))
        .await
        .context("create schema-1 fixture")?;
    let migration_error = store
        .migrate()
        .await
        .err()
        .ok_or_else(|| anyhow::anyhow!("schema-1 legacy tasks must block schema 2"))?;
    assert!(
        migration_error
            .to_string()
            .contains("without source_commit")
    );
    graph
        .run(query("MATCH (node) DETACH DELETE node"))
        .await
        .context("clean schema migration fixture")?;
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
             CREATE (activity)-[:FOR_TASK]->(activity_task)
             CREATE (:Attempt {
               id: 'schema-7-attempt',
               status: 'COMPLETED'
             })
             CREATE (retired:Task {
               id: 'schema-7-retired-task',
               status: 'COMPLETED',
               obsolete: true
             })
             CREATE (:Attempt {
               id: 'schema-7-retired-attempt',
               status: 'COMPLETED',
               obsolete: true
             })
             CREATE (blocker_parent:Task {
               id: 'schema-8-blocker-parent',
               kind: 'blocker',
               status: 'BLOCKED',
               blocked_reason: 'nested dependency',
               source_commit: '0123456789abcdef0123456789abcdef01234567',
               version: 4
             })
             CREATE (blocker_child:Task {
               id: 'schema-8-blocker-child',
               kind: 'blocker',
               status: 'COMPLETED',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (active_consumer:Task {
               id: 'schema-8-active-consumer',
               kind: 'main-repair',
               status: 'BLOCKED',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (active_consumer)-[:DEPENDS_ON]->(blocker_parent)
             CREATE (blocker_parent)-[:DEPENDS_ON]->(blocker_child)
             CREATE (completed_parent:Task {
               id: 'schema-8-completed-blocker-parent',
               kind: 'blocker',
               status: 'COMPLETED',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (completed_child:Task {
               id: 'schema-8-completed-blocker-child',
               kind: 'blocker',
               status: 'COMPLETED',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (historical_consumer:Task {
               id: 'schema-8-historical-consumer',
               kind: 'main-repair',
               status: 'READY',
               source_commit: '0123456789abcdef0123456789abcdef01234567'
             })
             CREATE (historical_consumer)-[:DEPENDS_ON]->(completed_parent)
             CREATE (completed_parent)-[:DEPENDS_ON]->(completed_child)",
        ))
        .await
        .context("create schema-3 fixture")?;
    store.migrate().await?;
    let mut rows = graph
        .execute(query(
            "MATCH (task:Task {id: 'schema-3-task'})
             MATCH (activity_task:Task {id: 'schema-6-activity-task'})
             MATCH (attempt:Attempt {id: 'schema-7-attempt'})
             MATCH (retired:Task {id: 'schema-7-retired-task'})
             MATCH (retired_attempt:Attempt {id: 'schema-7-retired-attempt'})
             MATCH (blocker_parent:Task {id: 'schema-8-blocker-parent'})
             MATCH (blocker_child:Task {id: 'schema-8-blocker-child'})
             MATCH (active_consumer:Task {id: 'schema-8-active-consumer'})
             MATCH (completed_parent:Task {id: 'schema-8-completed-blocker-parent'})
             MATCH (completed_child:Task {id: 'schema-8-completed-blocker-child'})
             MATCH (historical_consumer:Task {id: 'schema-8-historical-consumer'})
             MATCH (migration:HiveSchemaMigration {version: 9})
             OPTIONAL MATCH (blocker_parent)-[nested:DEPENDS_ON]->(:Task)
             OPTIONAL MATCH (completed_parent)-[history:DEPENDS_ON]->(:Task)
             OPTIONAL MATCH (active_consumer)-[active_flattened:DEPENDS_ON]->(blocker_child)
             OPTIONAL MATCH
               (historical_consumer)-[history_flattened:DEPENDS_ON]->(completed_child)
             RETURN task.last_retry_release AS last_retry_release,
                    task.manual_retry_used IS NULL AS removed_legacy_marker,
                    activity_task.latest_activity_at AS latest_activity_at,
                    task.obsolete AS task_obsolete,
                    attempt.obsolete AS attempt_obsolete,
                    retired.obsolete AS retired_obsolete,
                    retired_attempt.obsolete AS retired_attempt_obsolete,
                    blocker_parent.status AS blocker_status,
                    blocker_parent.blocked_reason IS NULL AS blocker_reason_removed,
                    blocker_parent.version AS blocker_version,
                    count(DISTINCT nested) AS nested_dependencies,
                    count(DISTINCT history) AS historical_dependencies,
                    count(DISTINCT active_flattened) AS active_flattened_dependencies,
                    max(active_flattened.artifact_depth) AS active_artifact_depth,
                    count(DISTINCT history_flattened) AS history_flattened_dependencies,
                    max(history_flattened.artifact_depth) AS history_artifact_depth,
                    migration.version AS version",
        ))
        .await?;
    let migrated = rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("schema-9 migration row was missing"))?;
    assert_eq!(migrated.get::<String>("last_retry_release")?, "");
    assert!(migrated.get::<bool>("removed_legacy_marker")?);
    assert_eq!(migrated.get::<i64>("latest_activity_at")?, 123456);
    assert!(!migrated.get::<bool>("task_obsolete")?);
    assert!(!migrated.get::<bool>("attempt_obsolete")?);
    assert!(migrated.get::<bool>("retired_obsolete")?);
    assert!(migrated.get::<bool>("retired_attempt_obsolete")?);
    assert_eq!(migrated.get::<String>("blocker_status")?, "READY");
    assert!(migrated.get::<bool>("blocker_reason_removed")?);
    assert_eq!(migrated.get::<i64>("blocker_version")?, 5);
    assert_eq!(migrated.get::<i64>("nested_dependencies")?, 0);
    assert_eq!(migrated.get::<i64>("historical_dependencies")?, 0);
    assert_eq!(migrated.get::<i64>("active_flattened_dependencies")?, 1);
    assert_eq!(migrated.get::<i64>("active_artifact_depth")?, 2);
    assert_eq!(migrated.get::<i64>("history_flattened_dependencies")?, 1);
    assert_eq!(migrated.get::<i64>("history_artifact_depth")?, 2);
    assert_eq!(migrated.get::<i64>("version")?, 9);
    let mut rollback_rows = graph
        .execute(query(
            "MATCH (task:Task {id: 'schema-4-rollback-task'})
             RETURN task.last_retry_release AS last_retry_release",
        ))
        .await?;
    let rollback = rollback_rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("schema-4 rollback row was missing"))?;
    assert_eq!(
        rollback.get::<String>("last_retry_release")?,
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    graph
        .run(query("MATCH (node) DETACH DELETE node"))
        .await
        .context("clean schema-9 migration fixture")?;
    Ok(())
}
