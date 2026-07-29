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
             })",
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
             MATCH (migration:HiveSchemaMigration {version: 8})
             RETURN task.last_retry_release AS last_retry_release,
                    task.manual_retry_used IS NULL AS removed_legacy_marker,
                    activity_task.latest_activity_at AS latest_activity_at,
                    task.obsolete AS task_obsolete,
                    attempt.obsolete AS attempt_obsolete,
                    retired.obsolete AS retired_obsolete,
                    retired_attempt.obsolete AS retired_attempt_obsolete,
                    migration.version AS version",
        ))
        .await?;
    let migrated = rows
        .next()
        .await?
        .ok_or_else(|| anyhow::anyhow!("schema-8 migration row was missing"))?;
    assert_eq!(migrated.get::<String>("last_retry_release")?, "");
    assert!(migrated.get::<bool>("removed_legacy_marker")?);
    assert_eq!(migrated.get::<i64>("latest_activity_at")?, 123456);
    assert!(!migrated.get::<bool>("task_obsolete")?);
    assert!(!migrated.get::<bool>("attempt_obsolete")?);
    assert!(migrated.get::<bool>("retired_obsolete")?);
    assert!(migrated.get::<bool>("retired_attempt_obsolete")?);
    assert_eq!(migrated.get::<i64>("version")?, 8);
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
        .context("clean schema-8 migration fixture")?;
    Ok(())
}
