use crate::HiveContext;
use crate::neo4j::Neo4jTaskStore;
use neo4rs::query;

const CONSTRAINTS: &[&str] = &[
    "CREATE CONSTRAINT hive_task_id IF NOT EXISTS FOR (node:Task) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_agent_id IF NOT EXISTS FOR (node:Agent) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_attempt_id IF NOT EXISTS FOR (node:Attempt) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_artifact_id IF NOT EXISTS FOR (node:Artifact) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_activity_id IF NOT EXISTS FOR (node:TaskActivity) REQUIRE node.id IS UNIQUE",
    "CREATE INDEX hive_task_claim IF NOT EXISTS FOR (node:Task) ON (node.status, node.priority, node.created_at)",
    "CREATE INDEX hive_activity_timeline IF NOT EXISTS FOR (node:TaskActivity) ON (node.created_at)",
];
const LATEST_SCHEMA_VERSION: i64 = 11;

impl Neo4jTaskStore {
    pub(super) async fn migrate_schema(&self) -> crate::HiveResult<()> {
        let graph = &self.graph;
        let mut rows = graph
            .execute(query(
                "MATCH (migration:HiveSchemaMigration)
                 RETURN migration.version AS version",
            ))
            .await?;
        let mut installed_version = 0_i64;
        while let Some(row) = rows.next().await? {
            let version = row.get::<i64>("version").map_err(|error| {
                crate::HiveError::message(format!(
                    "Hive schema migration marker has a malformed version: {error}"
                ))
            })?;
            if version < 0 {
                return Err(crate::HiveError::message(format!(
                    "Hive schema migration marker has an invalid negative version {version}"
                )));
            }
            installed_version = installed_version.max(version);
        }
        if installed_version > LATEST_SCHEMA_VERSION {
            return Err(crate::HiveError::message(format!(
                "Hive graph schema {installed_version} is newer than supported version {LATEST_SCHEMA_VERSION}"
            )));
        }
        if installed_version == 1 {
            Self::validate_legacy_schema_one(graph).await?;
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
            Self::migrate_blocker_dependencies(graph).await?;
        }
        if installed_version < 10 {
            graph
                .run(query(
                    "MATCH (task:Task)
                     SET task.origin_main_sha = coalesce(task.origin_main_sha, ''),
                         task.pinned_local_dev_sha = coalesce(task.pinned_local_dev_sha, ''),
                         task.feature_head_sha = coalesce(task.feature_head_sha, '')",
                ))
                .await
                .hive_context("failed to initialize schema-10 bootstrap evidence")?;
        }
        if installed_version < 11 {
            Self::validate_schema_eleven_tasks(graph).await?;
            graph
                .run(query(
                    "MATCH (task:Task)
                     SET task.feature_branch = coalesce(task.feature_branch, '')
                     REMOVE task.feature_head_sha",
                ))
                .await
                .hive_context("failed to initialize schema-11 canonical feature branches")?;
        } else {
            // A previous v11 attempt may have persisted the marker before this
            // cleanup was added. Reconcile that graph before allowing any
            // worker to use the v11 marker, while retaining the same
            // fail-closed evidence checks as the initial migration.
            Self::validate_schema_eleven_tasks(graph).await?;
            graph
                .run(query(
                    "MATCH (task:Task)
                     SET task.feature_branch = coalesce(task.feature_branch, '')
                     REMOVE task.feature_head_sha",
                ))
                .await
                .hive_context("failed to reconcile schema-11 canonical feature branches")?;
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

    async fn validate_legacy_schema_one(graph: &neo4rs::Graph) -> crate::HiveResult<()> {
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
            return Err(crate::HiveError::message(format!(
                "Hive schema 1 contains {legacy_tasks} task(s) without source_commit; \
                 drain or remove those legacy tasks before upgrading to schema 2"
            )));
        }
        Ok(())
    }

    async fn validate_schema_eleven_tasks(graph: &neo4rs::Graph) -> crate::HiveResult<()> {
        let mut rows = graph
            .execute(query(
                "MATCH (task:Task)
                 WITH task,
                      coalesce(task.origin_main_sha, '') AS origin_main_sha,
                      coalesce(task.pinned_local_dev_sha, '') AS pinned_local_dev_sha,
                      coalesce(task.feature_head_sha, '') AS feature_head_sha,
                      coalesce(task.feature_branch, '') AS feature_branch
                 RETURN count(CASE
                                WHEN (task.kind = 'main-repair'
                                      OR origin_main_sha <> ''
                                      OR pinned_local_dev_sha <> ''
                                      OR feature_head_sha <> '')
                                     AND feature_branch = ''
                                THEN 1
                              END) AS missing_feature_branch,
                        count(CASE
                                WHEN feature_branch <> ''
                                     AND (origin_main_sha = '' OR pinned_local_dev_sha = '')
                                THEN 1
                              END) AS incomplete_bootstrap_evidence,
                        count(CASE
                                WHEN feature_branch <> ''
                                     AND (NOT (feature_branch =~ 'codex/[a-z0-9/_-]+')
                                          OR feature_branch ENDS WITH '/')
                                THEN 1
                              END) AS invalid_feature_branch",
            ))
            .await?;
        let row = rows.next().await?.ok_or_else(|| {
            crate::HiveError::message("schema-11 migration validation returned no row")
        })?;
        let missing_feature_branch = row.get::<i64>("missing_feature_branch")?;
        let incomplete_bootstrap_evidence = row.get::<i64>("incomplete_bootstrap_evidence")?;
        let invalid_feature_branch = row.get::<i64>("invalid_feature_branch")?;
        if missing_feature_branch > 0
            || incomplete_bootstrap_evidence > 0
            || invalid_feature_branch > 0
        {
            return Err(crate::HiveError::message(format!(
                "schema-11 migration requires an existing canonical feature_branch for every task with bootstrap evidence; found {missing_feature_branch} task(s) without a derivable branch, {incomplete_bootstrap_evidence} task(s) with incomplete bootstrap evidence, and {invalid_feature_branch} task(s) with an invalid branch; feature_head_sha cannot be reinterpreted as a branch"
            )));
        }
        Ok(())
    }

    async fn migrate_blocker_dependencies(graph: &neo4rs::Graph) -> crate::HiveResult<()> {
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
            .hive_context("failed to preserve and detach schema-9 blocker dependencies")
    }
}
