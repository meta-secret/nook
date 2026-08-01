use crate::HiveContext;
use async_trait::async_trait;
use neo4rs::{ConfigBuilder, Graph, Row, query};
use serde::Serialize;
use uuid::Uuid;

use self::claim_retry::{CLAIM_RETRY_LIMIT, transient_claim_retry_delay};
use crate::install_rustls_crypto_provider;
use crate::model::{
    ActivityLease, AgentId, Artifact, AttemptId, CancellationTarget, ClaimOutcome, ClaimedTask,
    CompletionArtifact, DependencyResult, EnqueueTask, LeaseToken, TaskActivity, TaskId,
};
use crate::store::TaskStore;

mod admin;
mod block;
mod claim_retry;
mod rearm;

const CONSTRAINTS: &[&str] = &[
    "CREATE CONSTRAINT hive_task_id IF NOT EXISTS FOR (node:Task) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_agent_id IF NOT EXISTS FOR (node:Agent) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_attempt_id IF NOT EXISTS FOR (node:Attempt) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_artifact_id IF NOT EXISTS FOR (node:Artifact) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_activity_id IF NOT EXISTS FOR (node:TaskActivity) REQUIRE node.id IS UNIQUE",
    "CREATE INDEX hive_task_claim IF NOT EXISTS FOR (node:Task) ON (node.status, node.priority, node.created_at)",
    "CREATE INDEX hive_activity_timeline IF NOT EXISTS FOR (node:TaskActivity) ON (node.created_at)",
];
const LATEST_SCHEMA_VERSION: i64 = 8;
#[derive(Clone)]
pub struct Neo4jTaskStore {
    pub(crate) graph: Graph,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QueueTaskStatus {
    pub id: String,
    pub status: String,
    pub attempt_count: i64,
    pub max_attempts: i64,
    pub latest_attempt_status: String,
    pub latest_error: String,
    pub previous_attempt_status: String,
    pub previous_error: String,
    pub created_at: i64,
    pub last_retry_release: String,
}

#[async_trait]
impl TaskStore for Neo4jTaskStore {
    async fn migrate(&self) -> crate::HiveResult<()> {
        let mut rows = self
            .graph
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
            let mut rows = self
                .graph
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
            self.graph
                .run(query(
                    "MATCH (task:Task)
                     WHERE task.manual_retry_used IS NULL
                     SET task.manual_retry_used = false",
                ))
                .await
                .hive_context("failed to initialize schema-3 manual retry state")?;
        }
        if installed_version < 4 {
            self.graph
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
            self.graph
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
            self.graph
                .run(query(
                    "MATCH (task:Task)
                     WHERE task.obsolete IS NULL
                     SET task.obsolete = false",
                ))
                .await
                .hive_context("failed to backfill schema-8 task retirement state")?;
            self.graph
                .run(query(
                    "MATCH (attempt:Attempt)
                     WHERE attempt.obsolete IS NULL
                     SET attempt.obsolete = false",
                ))
                .await
                .hive_context("failed to backfill schema-8 attempt retirement state")?;
        }
        for statement in CONSTRAINTS {
            self.graph
                .run(query(statement))
                .await
                .with_hive_context(|| format!("failed to apply graph migration: {statement}"))?;
        }
        self.graph
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

    async fn register_agent(&self, agent_id: &AgentId, pod_name: &str) -> crate::HiveResult<()> {
        self.graph
            .run(
                query(
                    "MERGE (agent:Agent {id: $id})
                     ON CREATE SET agent.started_at = timestamp()
                     SET agent.pod_name = $pod_name,
                         agent.status = 'IDLE',
                         agent.last_seen_at = timestamp()",
                )
                .param("id", agent_id.as_str())
                .param("pod_name", pod_name),
            )
            .await
            .hive_context("failed to register Hive agent")
    }

    async fn enqueue(&self, task: &EnqueueTask) -> crate::HiveResult<()> {
        task.validate()?;
        let mut transaction = self.graph.start_txn().await?;
        let enqueue_token = Uuid::new_v4().to_string();
        let mut rows = transaction
            .execute(
                query(
                    "MERGE (task:Task {id: $id})
                     ON CREATE SET task.created_at = timestamp(),
                                   task.attempt_count = 0,
                                   task.last_retry_release = '',
                                   task.version = 0,
                                   task.obsolete = false,
                                   task.enqueue_token = $enqueue_token,
                                   task.kind = $kind,
                                   task.trigger_kind = $trigger_kind,
                                   task.prompt = $prompt,
                                   task.source_commit = $source_commit,
                                   task.priority = $priority,
                                   task.max_attempts = $max_attempts,
                                   task.status = 'BLOCKED',
                                   task.updated_at = timestamp()
                     RETURN task.enqueue_token = $enqueue_token AS created",
                )
                .param("id", task.id.as_str())
                .param("enqueue_token", enqueue_token.as_str())
                .param("kind", task.kind.as_str())
                .param("trigger_kind", task.trigger.as_str())
                .param("prompt", task.prompt.as_str())
                .param("source_commit", task.source_commit.as_str())
                .param("priority", task.priority)
                .param("max_attempts", task.max_attempts),
            )
            .await?;
        let created = rows
            .next(transaction.handle())
            .await?
            .is_some_and(|row| row.get::<bool>("created").unwrap_or(false));
        if !created {
            transaction.rollback().await?;
            return Err(crate::error::HiveError::message(format!(
                "task {} already exists",
                task.id
            )));
        }

        for dependency in &task.dependencies {
            let mut rows = transaction
                .execute(
                    query(
                        "MATCH (task:Task {id: $id}), (dependency:Task {id: $dependency})
                         WHERE dependency.source_commit = task.source_commit
                         MERGE (task)-[:DEPENDS_ON]->(dependency)
                         SET dependency.version = coalesce(dependency.version, 0) + 1
                         RETURN dependency.id AS id",
                    )
                    .param("id", task.id.as_str())
                    .param("dependency", dependency.as_str()),
                )
                .await
                .with_hive_context(|| format!("dependency {} does not exist", dependency))?;
            if rows.next(transaction.handle()).await?.is_none() {
                transaction.rollback().await?;
                return Err(crate::error::HiveError::message(format!(
                    "dependency {dependency} does not exist or targets a different source commit"
                )));
            }
            drop(rows);
            Self::rearm_obsolete_subtree(&mut transaction, dependency).await?;
        }

        transaction
            .run(
                query(
                    "MATCH (task:Task {id: $id})
                     OPTIONAL MATCH (task)-[:DEPENDS_ON]->(dependency:Task)
                     WITH task, count(dependency) AS dependency_count,
                          count(CASE WHEN dependency.status = 'COMPLETED' THEN 1 END) AS completed_count,
                          count(CASE WHEN dependency.status = 'FAILED' THEN 1 END) AS failed_count
                     SET task.status = CASE
                       WHEN failed_count > 0 THEN 'FAILED'
                       WHEN dependency_count = completed_count THEN 'READY'
                       ELSE 'BLOCKED'
                     END,
                     task.failure_reason = CASE
                       WHEN failed_count > 0 THEN 'dependency failed before task enqueue'
                       ELSE null
                     END",
                )
                .param("id", task.id.as_str()),
            )
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn active_delivery(
        &self,
        source_commit: &str,
        kind: &str,
    ) -> crate::HiveResult<Option<TaskId>> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (root:Task {source_commit: $source_commit, kind: $kind})
                     WHERE root.status IN ['READY', 'RUNNING', 'CANCELLING', 'BLOCKED']
                        OR EXISTS {
                          MATCH (root)-[:DEPENDS_ON*1..]->(descendant:Task)
                          WHERE descendant.status = 'CANCELLING'
                        }
                     RETURN root.id AS id
                     ORDER BY root.created_at
                     LIMIT 1",
                )
                .param("source_commit", source_commit)
                .param("kind", kind),
            )
            .await?;
        rows.next()
            .await?
            .map(|row| Ok(TaskId::new(row.get::<String>("id")?)?))
            .transpose()
    }

    async fn cancel(&self, task_id: &TaskId, reason: &str) -> crate::HiveResult<bool> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (root:Task {id: $task_id})
                     WHERE root.status IN ['READY', 'RUNNING', 'BLOCKED', 'FAILED']
                     OPTIONAL MATCH (root)-[:DEPENDS_ON*1..]->(descendant:Task)
                     WITH root, collect(DISTINCT descendant) AS descendants
                     WITH root, descendants,
                          [descendant IN descendants
                           WHERE descendant.status IN ['READY', 'RUNNING', 'BLOCKED']
                             AND NOT EXISTS {
                               MATCH (outside:Task)-[:DEPENDS_ON*1..]->(descendant)
                               WHERE outside.status IN ['READY', 'RUNNING', 'BLOCKED']
                                 AND NOT (outside IN ([root] + descendants))
                             }] AS exclusive_descendants
                     WITH root, [root] + exclusive_descendants AS members
                     UNWIND members AS task
                     OPTIONAL MATCH (task)<-[:FOR_TASK]-(attempt:Attempt {status: 'RUNNING'})
                     OPTIONAL MATCH (agent:Agent)-[:EXECUTED]->(attempt)
                     WITH task, attempt, agent, task.status = 'RUNNING' AS was_running
                     SET task.status =
                           CASE was_running
                             WHEN true THEN 'CANCELLING'
                             ELSE 'CANCELLED'
                           END,
                         task.failure_reason = $reason,
                         task.updated_at = timestamp(),
                         task.version = task.version + 1,
                         task.lease_owner =
                           CASE was_running WHEN true THEN task.lease_owner ELSE null END,
                         task.lease_token =
                           CASE was_running WHEN true THEN task.lease_token ELSE null END,
                         task.lease_until =
                           CASE was_running WHEN true THEN task.lease_until ELSE null END,
                         attempt.status =
                           CASE was_running WHEN true THEN attempt.status ELSE 'CANCELLED' END,
                         attempt.error =
                           CASE was_running WHEN true THEN attempt.error ELSE $reason END,
                         attempt.completed_at =
                           CASE was_running WHEN true THEN attempt.completed_at ELSE timestamp() END,
                         agent.status =
                           CASE was_running WHEN true THEN agent.status ELSE 'IDLE' END,
                         agent.last_seen_at = timestamp()
                     RETURN DISTINCT task.id AS id",
                )
                .param("task_id", task_id.as_str())
                .param("reason", reason),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }

    async fn acknowledge_cancellation(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
    ) -> crate::HiveResult<bool> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})<-[:FOR_TASK]-(attempt:Attempt)
                     MATCH (agent:Agent {id: $agent_id})-[:EXECUTED]->(attempt)
                     WHERE task.status = 'CANCELLING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND attempt.lease_token = $lease_token
                     SET task.status = 'CANCELLED',
                         task.updated_at = timestamp(),
                         task.version = task.version + 1,
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'CANCELLED',
                         attempt.error = coalesce(task.failure_reason, 'cancelled'),
                         attempt.completed_at = timestamp(),
                         agent.status = 'IDLE',
                         agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task.id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", task.lease_token.as_str()),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }

    async fn cancellation_targets(
        &self,
        task_id: &TaskId,
    ) -> crate::HiveResult<Vec<CancellationTarget>> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (root:Task {id: $task_id})
                     OPTIONAL MATCH (root)-[:DEPENDS_ON*0..]->(task:Task)
                     WITH DISTINCT task
                     WHERE task.status = 'CANCELLING'
                     MATCH (task)<-[:FOR_TASK]-(attempt:Attempt {status: 'RUNNING'})
                     MATCH (agent:Agent)-[:EXECUTED]->(attempt)
                     WHERE attempt.lease_token = task.lease_token
                     RETURN task.id AS task_id, agent.pod_name AS pod_name",
                )
                .param("task_id", task_id.as_str()),
            )
            .await?;
        let mut targets = Vec::new();
        while let Some(row) = rows.next().await? {
            targets.push(CancellationTarget {
                task_id: TaskId::new(row.get::<String>("task_id")?)?,
                pod_name: row.get("pod_name")?,
            });
        }
        Ok(targets)
    }

    async fn finalize_cancellation(&self, task_id: &TaskId) -> crate::HiveResult<bool> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})
                     WHERE task.status IN ['CANCELLING', 'CANCELLED']
                     OPTIONAL MATCH (task)<-[:FOR_TASK]-(attempt:Attempt {status: 'RUNNING'})
                     WHERE attempt.lease_token = task.lease_token
                     OPTIONAL MATCH (agent:Agent)-[:EXECUTED]->(attempt)
                     SET task.status = 'CANCELLED',
                         task.updated_at = timestamp(),
                         task.version = task.version + 1,
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'CANCELLED',
                         attempt.error = coalesce(task.failure_reason, 'cancelled'),
                         attempt.completed_at = timestamp(),
                         agent.status = 'IDLE',
                         agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task_id.as_str()),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }

    async fn claim(
        &self,
        agent_id: &AgentId,
        lease_seconds: i64,
    ) -> crate::HiveResult<ClaimOutcome> {
        for retry in 0..CLAIM_RETRY_LIMIT {
            let result = async {
                let attempt_id =
                    AttemptId::new(Uuid::new_v4().to_string())?;
                let lease_token =
                    LeaseToken::new(Uuid::new_v4().to_string())?;
                let mut transaction = self.graph.start_txn().await?;

                transaction
                    .run(query(
                "MATCH (task:Task)<-[:FOR_TASK]-(attempt:Attempt {status: 'RUNNING'})
                 WHERE task.status = 'RUNNING'
                   AND task.lease_until <= timestamp()
                   AND task.attempt_count >= task.max_attempts
                 OPTIONAL MATCH (agent:Agent)-[:EXECUTED]->(attempt)
                 SET task.status = 'FAILED',
                     task.updated_at = timestamp(),
                     task.failure_reason = 'lease expired after final attempt',
                     task.lease_owner = null,
                     task.lease_token = null,
                     task.lease_until = null,
                     attempt.status = 'EXPIRED',
                     attempt.error = 'lease expired after final attempt',
                     attempt.completed_at = timestamp(),
                     agent.status = 'IDLE',
                     agent.last_seen_at = timestamp()",
                    ))
                    .await?;

                transaction
                    .run(query(
                        "MATCH (failed:Task {
                           status: 'FAILED',
                           failure_reason: 'lease expired after final attempt'
                         })
                         MATCH (dependent:Task)-[:DEPENDS_ON*1..]->(failed)
                         WHERE dependent.status IN ['READY', 'BLOCKED']
                         SET dependent.status = 'FAILED',
                             dependent.blocked_reason =
                               'upstream dependency failed after its final lease expired',
                             dependent.updated_at = timestamp(),
                             dependent.version = dependent.version + 1",
                    ))
                    .await?;

                let mut candidates = transaction
                    .execute(query(
                "MATCH (task:Task)
                 WHERE (
                   task.status = 'READY'
                   OR (task.status = 'RUNNING' AND task.lease_until <= timestamp())
                 )
                   AND task.attempt_count < task.max_attempts
                   AND NOT EXISTS {
                     MATCH (task)-[:DEPENDS_ON]->(dependency:Task)
                     WHERE dependency.status <> 'COMPLETED'
                   }
                 WITH task
                 ORDER BY task.priority DESC, task.created_at ASC, task.id ASC
                 LIMIT 1
                 SET task.claim_lock = coalesce(task.claim_lock, 0) + 1
                 RETURN task.id AS id",
                    ))
                    .await?;
                let Some(candidate) = candidates.next(transaction.handle()).await? else {
                    transaction.commit().await?;
                    return Ok(ClaimOutcome::NoTask);
                };
                let task_id: String = candidate.get("id")?;

                let mut rows = transaction
                    .execute(
                        query(
                    "MATCH (task:Task {id: $id})
                     WHERE (
                       task.status = 'READY'
                       OR (task.status = 'RUNNING' AND task.lease_until <= timestamp())
                     )
                       AND task.attempt_count < task.max_attempts
                       AND NOT EXISTS {
                         MATCH (task)-[:DEPENDS_ON]->(dependency:Task)
                         WHERE dependency.status <> 'COMPLETED'
                       }
                     OPTIONAL MATCH (task)-[:DEPENDS_ON]->(dependency:Task)
                     WITH task,
                          [value IN collect(dependency.id) WHERE value IS NOT NULL] AS dependency_ids,
                          [value IN collect(coalesce(dependency.result_summary, '')) WHERE value IS NOT NULL] AS dependency_summaries
                     OPTIONAL MATCH dependency_path =
                       (task)-[:DEPENDS_ON*1..]->(artifact_task:Task)
                     OPTIONAL MATCH (artifact_task)
                       <-[:FOR_TASK]-(dependency_attempt:Attempt {status: 'COMPLETED'})
                       -[:PRODUCED]->(dependency_artifact:Artifact {kind: 'git-patch'})
                     WITH task, dependency_ids, dependency_summaries,
                          dependency_artifact,
                          max(length(dependency_path)) AS dependency_depth
                     ORDER BY dependency_depth DESC, dependency_artifact.id ASC
                     WITH task, dependency_ids, dependency_summaries,
                          [value IN collect(dependency_artifact.id) WHERE value IS NOT NULL] AS artifact_ids,
                          [value IN collect(dependency_artifact.kind) WHERE value IS NOT NULL] AS artifact_kinds,
                          [value IN collect(dependency_artifact.uri) WHERE value IS NOT NULL] AS artifact_uris,
                          [value IN collect(dependency_artifact.digest) WHERE value IS NOT NULL] AS artifact_digests,
                          [value IN collect(dependency_artifact.content) WHERE value IS NOT NULL] AS artifact_contents
                     OPTIONAL MATCH (active_owner:Task)-[:DEPENDS_ON*1..]->(task)
                     WHERE active_owner.kind <> 'blocker'
                       AND active_owner.status IN ['READY', 'RUNNING', 'CANCELLING', 'BLOCKED']
                     WITH DISTINCT task, dependency_ids, dependency_summaries,
                          artifact_ids, artifact_kinds, artifact_uris, artifact_digests,
                          artifact_contents, active_owner
                     ORDER BY active_owner.id
                     WITH task, dependency_ids, dependency_summaries,
                          artifact_ids, artifact_kinds, artifact_uris, artifact_digests,
                          artifact_contents,
                          collect(active_owner) AS active_owners
                     WITH task, dependency_ids, dependency_summaries,
                          artifact_ids, artifact_kinds, artifact_uris, artifact_digests,
                          artifact_contents,
                          CASE
                            WHEN size(active_owners) > 0
                              AND all(owner IN active_owners WHERE owner.kind = 'main-repair')
                            THEN [owner IN active_owners | owner.id]
                            ELSE []
                          END AS owning_repair_ids
                     OPTIONAL MATCH (task)<-[:FOR_TASK]-(expired_attempt:Attempt {status: 'RUNNING'})
                     WHERE expired_attempt.lease_token = task.lease_token
                     OPTIONAL MATCH (expired_agent:Agent)-[:EXECUTED]->(expired_attempt)
                     SET task.status = 'RUNNING',
                         task.lease_owner = $agent_id,
                         task.lease_token = $lease_token,
                         task.lease_until = timestamp() + ($lease_seconds * 1000),
                         task.attempt_count = task.attempt_count + 1,
                         task.version = task.version + 1,
                         task.updated_at = timestamp(),
                         expired_attempt.status = 'EXPIRED',
                         expired_attempt.error = 'lease expired and task was reclaimed',
                         expired_attempt.completed_at = timestamp(),
                         expired_agent.status = 'IDLE',
                         expired_agent.last_seen_at = timestamp()
                     CREATE (attempt:Attempt {
                       id: $attempt_id,
                       number: task.attempt_count,
                       status: 'RUNNING',
                       obsolete: false,
                       started_at: timestamp(),
                       lease_token: $lease_token
                     })
                     WITH task, attempt, dependency_ids, dependency_summaries,
                          artifact_ids, artifact_kinds, artifact_uris, artifact_digests,
                          artifact_contents, owning_repair_ids
                     MATCH (agent:Agent {id: $agent_id})
                     MERGE (agent)-[:EXECUTED]->(attempt)
                     MERGE (attempt)-[:FOR_TASK]->(task)
                     SET agent.status = 'RUNNING', agent.last_seen_at = timestamp()
                     RETURN task.id AS id,
                            task.kind AS kind,
                            task.prompt AS prompt,
                            task.source_commit AS source_commit,
                            attempt.number AS attempt_number,
                            owning_repair_ids,
                            dependency_ids,
                            dependency_summaries,
                            artifact_ids,
                            artifact_kinds,
                            artifact_uris,
                            artifact_digests,
                            artifact_contents",
                        )
                        .param("id", task_id)
                        .param("agent_id", agent_id.as_str())
                        .param("lease_token", lease_token.as_str())
                        .param("lease_seconds", lease_seconds)
                        .param("attempt_id", attempt_id.as_str()),
                    )
                    .await?;
                let Some(row) = rows.next(transaction.handle()).await? else {
                    transaction.rollback().await?;
                    return Ok(ClaimOutcome::NoTask);
                };
                let claimed = Self::claimed_task(row, attempt_id, lease_token)?;
                transaction.commit().await?;
                Ok(ClaimOutcome::Claimed(Box::new(claimed)))
            }
            .await;

            match result {
                Ok(claimed) => return Ok(claimed),
                Err(error) => match transient_claim_retry_delay(retry, &error) {
                    Some(delay) => tokio::time::sleep(delay).await,
                    None => return Err(error),
                },
            }
        }
        Err(crate::error::HiveError::message(
            "Neo4j claim retry budget exhausted after transient failures",
        ))
    }

    async fn heartbeat(
        &self,
        task_id: &TaskId,
        agent_id: &AgentId,
        lease_token: &LeaseToken,
        lease_seconds: i64,
    ) -> crate::HiveResult<bool> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND task.lease_until > timestamp()
                     SET task.lease_until = timestamp() + ($lease_seconds * 1000),
                         task.updated_at = timestamp()
                     WITH task
                     MATCH (agent:Agent {id: $agent_id})
                     SET agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", lease_token.as_str())
                .param("lease_seconds", lease_seconds),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }

    async fn record_activity(
        &self,
        lease: &ActivityLease,
        agent_id: &AgentId,
        activity: &TaskActivity,
    ) -> crate::HiveResult<bool> {
        let id = Uuid::new_v4().to_string();
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})<-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND task.lease_until > timestamp()
                       AND attempt.lease_token = $lease_token
                     CREATE (activity:TaskActivity {
                       id: $id,
                       kind: $kind,
                       message: $message,
                       detail: $detail,
                       created_at: timestamp()
                     })
                     MERGE (activity)-[:FOR_TASK]->(task)
                     MERGE (activity)-[:FOR_ATTEMPT]->(attempt)
                     SET task.latest_activity_at = activity.created_at
                     WITH task, activity
                     OPTIONAL MATCH (older:TaskActivity)-[:FOR_TASK]->(task)
                     WITH activity, older
                     ORDER BY older.created_at DESC, older.id DESC
                     WITH activity, collect(older)[200..] AS expired
                     FOREACH (entry IN expired | DETACH DELETE entry)
                     RETURN activity.id AS id",
                )
                .param("task_id", lease.task_id.as_str())
                .param("attempt_id", lease.attempt_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", lease.lease_token.as_str())
                .param("id", id)
                .param("kind", activity.kind.as_str())
                .param("message", activity.message.as_str())
                .param("detail", activity.detail.as_str()),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }

    async fn release(&self, task: &ClaimedTask, agent_id: &AgentId) -> crate::HiveResult<bool> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})<-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND attempt.lease_token = $lease_token
                     SET task.status = 'READY',
                         task.attempt_count = task.attempt_count - 1,
                         task.updated_at = timestamp(),
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'INTERRUPTED',
                         attempt.error = 'worker terminated for rollout',
                         attempt.completed_at = timestamp()
                     WITH task
                     MATCH (agent:Agent {id: $agent_id})
                     SET agent.status = 'IDLE', agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task.id.as_str())
                .param("attempt_id", task.attempt_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", task.lease_token.as_str()),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }

    async fn complete(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        obsolete: bool,
        summary: &str,
        artifact: &CompletionArtifact,
    ) -> crate::HiveResult<bool> {
        let mut transaction = self.graph.start_txn().await?;
        let mut rows = transaction
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})<-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND task.lease_until > timestamp()
                       AND attempt.lease_token = $lease_token
                     OPTIONAL MATCH (active_owner:Task)-[:DEPENDS_ON*1..]->(task)
                     WHERE active_owner.kind <> 'blocker'
                       AND active_owner.status IN ['READY', 'RUNNING', 'CANCELLING', 'BLOCKED']
                     WITH task, attempt, collect(DISTINCT active_owner) AS active_owners
                     WHERE NOT $obsolete
                        OR (
                          size($owning_repair_ids) > 0
                          AND size(active_owners) = size($owning_repair_ids)
                          AND all(
                            owner IN active_owners
                            WHERE owner.kind = 'main-repair'
                              AND owner.id IN $owning_repair_ids
                          )
                        )
                     SET task.status = 'COMPLETED',
                         task.obsolete = $obsolete,
                         task.result_summary = $summary,
                         task.updated_at = timestamp(),
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'COMPLETED',
                         attempt.obsolete = $obsolete,
                         attempt.summary = $summary,
                         attempt.completed_at = timestamp()
                     WITH task
                     MATCH (agent:Agent {id: $agent_id})
                     SET agent.status = 'IDLE', agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task.id.as_str())
                .param("attempt_id", task.attempt_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", task.lease_token.as_str())
                .param("obsolete", obsolete)
                .param(
                    "owning_repair_ids",
                    task.owning_repairs
                        .iter()
                        .map(|owner| owner.as_str())
                        .collect::<Vec<_>>(),
                )
                .param("summary", summary),
            )
            .await?;
        let accepted = rows.next(transaction.handle()).await?.is_some();
        if !accepted {
            transaction.rollback().await?;
            return Ok(false);
        }

        if let CompletionArtifact::Produced(artifact) = artifact {
            transaction
                .run(
                    query(
                        "MATCH (attempt:Attempt {id: $attempt_id})
                         CREATE (artifact:Artifact {
                           id: $artifact_id,
                           kind: $kind,
                           uri: $uri,
                           digest: $digest,
                           content: $content,
                           created_at: timestamp()
                         })
                         CREATE (attempt)-[:PRODUCED]->(artifact)",
                    )
                    .param("attempt_id", task.attempt_id.as_str())
                    .param("artifact_id", artifact.id.as_str())
                    .param("kind", artifact.kind.as_str())
                    .param("uri", artifact.uri.as_str())
                    .param("digest", artifact.digest.as_str())
                    .param("content", artifact.content.as_str()),
                )
                .await?;
        }

        transaction
            .run(query(
                "MATCH (blocked:Task {status: 'BLOCKED'})
                 WHERE NOT EXISTS {
                   MATCH (blocked)-[:DEPENDS_ON]->(dependency:Task)
                   WHERE dependency.status <> 'COMPLETED'
                 }
                 SET blocked.status = 'READY',
                     blocked.blocked_reason = null,
                     blocked.updated_at = timestamp(),
                     blocked.version = blocked.version + 1",
            ))
            .await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn fail(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        error: &str,
    ) -> crate::HiveResult<bool> {
        let mut transaction = self.graph.start_txn().await?;
        let mut rows = transaction
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})<-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND attempt.lease_token = $lease_token
                     SET task.status = CASE
                           WHEN task.attempt_count < task.max_attempts THEN 'READY'
                           ELSE 'FAILED'
                         END,
                         task.updated_at = timestamp(),
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'FAILED',
                         attempt.error = $error,
                         attempt.completed_at = timestamp()
                     WITH task
                     MATCH (agent:Agent {id: $agent_id})
                     SET agent.status = 'IDLE', agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task.id.as_str())
                .param("attempt_id", task.attempt_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", task.lease_token.as_str())
                .param("error", error),
            )
            .await?;
        let accepted = rows.next(transaction.handle()).await?.is_some();
        if !accepted {
            transaction.rollback().await?;
            return Ok(false);
        }
        transaction
            .run(
                query(
                    "MATCH (failed:Task {id: $task_id, status: 'FAILED'})
                     MATCH (dependent:Task)-[:DEPENDS_ON*1..]->(failed)
                     WHERE dependent.status IN ['READY', 'BLOCKED']
                     SET dependent.status = 'FAILED',
                         dependent.blocked_reason = $dependency_error,
                         dependent.updated_at = timestamp(),
                         dependent.version = dependent.version + 1",
                )
                .param("task_id", task.id.as_str())
                .param(
                    "dependency_error",
                    format!("dependency {} exhausted its retry budget", task.id),
                ),
            )
            .await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn block(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        blocker: &EnqueueTask,
        reason: &str,
    ) -> crate::HiveResult<bool> {
        blocker.validate()?;
        if blocker.source_commit != task.source_commit {
            return Err(crate::error::HiveError::message(
                "a blocker must target the same pinned repository revision",
            ));
        }
        if !blocker.dependencies.is_empty() {
            return Err(crate::error::HiveError::message(
                "a newly discovered blocker must not have undeclared dependencies",
            ));
        }
        self.block_task(task, agent_id, blocker, reason).await
    }
}
