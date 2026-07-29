use anyhow::Context;
use async_trait::async_trait;
use neo4rs::{ConfigBuilder, Graph, Row, Txn, query};
use serde::Serialize;
use uuid::Uuid;

use self::claim_retry::{CLAIM_RETRY_LIMIT, transient_claim_retry_delay};
use crate::install_rustls_crypto_provider;
use crate::model::{
    ActivityLease, AgentId, Artifact, AttemptId, CancellationTarget, ClaimOutcome, ClaimedTask,
    CompletionArtifact, DependencyResult, EnqueueTask, LeaseToken, TaskActivity, TaskId,
};
use crate::store::TaskStore;

mod claim_retry;

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

impl Neo4jTaskStore {
    pub async fn connect(uri: &str, username: &str, password: &str) -> anyhow::Result<Self> {
        install_rustls_crypto_provider()?;
        let config = ConfigBuilder::default()
            .uri(uri)
            .user(username)
            .password(password)
            .db("neo4j")
            .build()
            .context("invalid Neo4j configuration")?;
        let graph = Graph::connect(config)
            .await
            .context("failed to connect to Neo4j")?;
        Ok(Self { graph })
    }

    async fn rearm_obsolete_subtree(
        transaction: &mut Txn,
        root_id: &TaskId,
    ) -> anyhow::Result<bool> {
        let mut root_rows = transaction
            .execute(
                query(
                    "MATCH (root:Task {id: $root_id})
                     RETURN coalesce(root.obsolete, false) AS obsolete",
                )
                .param("root_id", root_id.as_str()),
            )
            .await?;
        let root_was_obsolete = match root_rows.next(transaction.handle()).await? {
            Some(row) => row.get::<bool>("obsolete")?,
            None => false,
        };
        drop(root_rows);
        if !root_was_obsolete {
            return Ok(false);
        }
        let mut rows = transaction
            .execute(
                query(
                    "MATCH path =
                       (root:Task {id: $root_id})-[:DEPENDS_ON*0..]->(retired:Task)
                     WHERE retired.obsolete = true
                     WITH retired, max(length(path)) AS depth
                     RETURN retired.id AS id, depth
                     ORDER BY depth DESC",
                )
                .param("root_id", root_id.as_str()),
            )
            .await?;
        let mut retired_ids = Vec::new();
        while let Some(row) = rows.next(transaction.handle()).await? {
            retired_ids.push(TaskId::new(row.get::<String>("id")?)?);
        }
        drop(rows);
        for retired_id in retired_ids {
            transaction
                .run(
                    query(
                        "MATCH (retired:Task {id: $retired_id})
                         WHERE retired.obsolete = true
                         OPTIONAL MATCH (retired)-[:DEPENDS_ON]->(dependency:Task)
                         WITH retired, count(dependency) AS dependency_count,
                              count(
                                CASE WHEN dependency.status = 'COMPLETED' THEN 1 END
                              ) AS completed_count,
                              count(
                                CASE WHEN dependency.status = 'FAILED' THEN 1 END
                              ) AS failed_count
                         SET retired.status = CASE
                               WHEN failed_count > 0 THEN 'FAILED'
                               WHEN dependency_count = completed_count THEN 'READY'
                               ELSE 'BLOCKED'
                             END,
                             retired.obsolete = false,
                             retired.max_attempts =
                               coalesce(retired.attempt_count, 0) + 3,
                             retired.result_summary = null,
                             retired.blocked_reason = CASE
                               WHEN failed_count = 0
                                 AND dependency_count <> completed_count
                                 THEN 'obsolete task has incomplete prerequisites'
                               ELSE null
                             END,
                             retired.failure_reason = CASE
                               WHEN failed_count > 0
                                 THEN 'dependency failed before obsolete task rearm'
                               ELSE null
                             END,
                             retired.updated_at = timestamp(),
                             retired.version = coalesce(retired.version, 0) + 1",
                    )
                    .param("retired_id", retired_id.as_str()),
                )
                .await?;
        }
        Ok(root_was_obsolete)
    }

    pub async fn queue_status(&self, limit: i64) -> anyhow::Result<Vec<QueueTaskStatus>> {
        if !(1..=200).contains(&limit) {
            anyhow::bail!("queue status limit must be between 1 and 200");
        }
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task)
                     OPTIONAL MATCH (task)<-[:FOR_TASK]-(attempt:Attempt)
                     WITH task, attempt
                     ORDER BY attempt.completed_at DESC, attempt.started_at DESC
                     WITH task, collect(attempt) AS attempts
                     WITH task, attempts[0] AS latest, attempts[1] AS previous
                     RETURN task.id AS id,
                            task.status AS status,
                            task.attempt_count AS attempt_count,
                            task.max_attempts AS max_attempts,
                            coalesce(latest.status, '') AS latest_attempt_status,
                            substring(
                              replace(coalesce(latest.error, ''), '\n', ' '),
                              0,
                              600
                            ) AS latest_error,
                            coalesce(previous.status, '') AS previous_attempt_status,
                            substring(
                              replace(coalesce(previous.error, ''), '\n', ' '),
                              0,
                              600
                            ) AS previous_error,
                            task.created_at AS created_at,
                            coalesce(task.last_retry_release, '') AS last_retry_release
                     ORDER BY created_at DESC
                     LIMIT $limit",
                )
                .param("limit", limit),
            )
            .await?;
        let mut tasks = Vec::new();
        while let Some(row) = rows.next().await? {
            tasks.push(QueueTaskStatus {
                id: row.get("id")?,
                status: row.get("status")?,
                attempt_count: row.get("attempt_count")?,
                max_attempts: row.get("max_attempts")?,
                latest_attempt_status: row.get("latest_attempt_status")?,
                latest_error: row.get("latest_error")?,
                previous_attempt_status: row.get("previous_attempt_status")?,
                previous_error: row.get("previous_error")?,
                created_at: row.get("created_at")?,
                last_retry_release: row.get("last_retry_release")?,
            });
        }
        Ok(tasks)
    }

    pub async fn retry_failed_main_task(
        &self,
        task_id: &TaskId,
        release_id: &str,
    ) -> anyhow::Result<bool> {
        let digest = release_id
            .strip_prefix("sha256:")
            .filter(|digest| {
                digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
            .context("release id must be a sha256 digest")?;
        let release_id = format!("sha256:{digest}");
        let mut transaction = self.graph.start_txn().await?;
        let mut eligible_rows = transaction
            .execute(
                query(
                    "MATCH (root:Task {id: $id})
                     WHERE root.kind = 'main-repair'
                       AND root.status = 'FAILED'
                       AND coalesce(root.last_retry_release, '') <> $release_id
                       AND NOT EXISTS {
                         MATCH (root)-[:DEPENDS_ON*0..]->(running:Task)
                               <-[:FOR_TASK]-(:Attempt {status: 'RUNNING'})
                       }
                     RETURN root.id AS id",
                )
                .param("id", task_id.as_str())
                .param("release_id", release_id.as_str()),
            )
            .await?;
        let eligible = eligible_rows.next(transaction.handle()).await?.is_some();
        drop(eligible_rows);
        if !eligible {
            transaction.rollback().await?;
            return Ok(false);
        }
        let mut lock_rows = transaction
            .execute(
                query(
                    "MATCH (root:Task {id: $id})-[:DEPENDS_ON*0..]->(member:Task)
                     WITH DISTINCT member
                     ORDER BY member.id
                     SET member.version = coalesce(member.version, 0) + 1
                     RETURN count(member) AS locked",
                )
                .param("id", task_id.as_str()),
            )
            .await?;
        anyhow::ensure!(
            lock_rows.next(transaction.handle()).await?.is_some(),
            "retryable Main repair graph disappeared while acquiring revival locks"
        );
        drop(lock_rows);
        let mut obsolete_rows = transaction
            .execute(
                query(
                    "MATCH path =
                       (root:Task {id: $id})-[:DEPENDS_ON*1..]->(retired:Task)
                     WHERE retired.obsolete = true
                     WITH retired, min(length(path)) AS depth
                     RETURN retired.id AS id
                     ORDER BY depth ASC",
                )
                .param("id", task_id.as_str()),
            )
            .await?;
        let mut obsolete_ids = Vec::new();
        while let Some(row) = obsolete_rows.next(transaction.handle()).await? {
            obsolete_ids.push(TaskId::new(row.get::<String>("id")?)?);
        }
        drop(obsolete_rows);
        for obsolete_id in &obsolete_ids {
            Self::rearm_obsolete_subtree(&mut transaction, obsolete_id).await?;
        }
        let mut rows = transaction
            .execute(
                query(
                    "MATCH (root:Task {id: $id})
                     WHERE root.kind = 'main-repair'
                       AND root.status = 'FAILED'
                       AND coalesce(root.last_retry_release, '') <> $release_id
                     MATCH (root)-[:DEPENDS_ON*0..]->(member:Task)
                     WITH root, collect(DISTINCT member) AS members
                     UNWIND members AS member
                     WITH root, member
                     WHERE member.status = 'FAILED'
                     OPTIONAL MATCH (member)-[:DEPENDS_ON]->(dependency:Task)
                     WITH root,
                          member,
                          count(dependency) AS dependency_count,
                          count(CASE WHEN dependency.status = 'COMPLETED' THEN 1 END)
                            AS completed_count
                     SET member.status = CASE
                           WHEN dependency_count = completed_count THEN 'READY'
                           ELSE 'BLOCKED'
                         END,
                         member.max_attempts = member.attempt_count + 3,
                         member.failure_reason = null,
                         member.blocked_reason = null,
                         member.updated_at = timestamp(),
                         member.version = member.version + 1,
                         root.last_retry_release = $release_id
                     RETURN DISTINCT root.id AS id",
                )
                .param("id", task_id.as_str())
                .param("release_id", release_id),
            )
            .await?;
        let retried = rows.next(transaction.handle()).await?.is_some();
        drop(rows);
        if retried {
            transaction.commit().await?;
        } else {
            transaction.rollback().await?;
        }
        Ok(retried)
    }

    fn claimed_task(
        row: Row,
        attempt_id: AttemptId,
        lease_token: LeaseToken,
    ) -> anyhow::Result<ClaimedTask> {
        let dependency_ids: Vec<String> = row.get("dependency_ids")?;
        let dependency_summaries: Vec<String> = row.get("dependency_summaries")?;
        let dependency_context = dependency_ids
            .into_iter()
            .zip(dependency_summaries)
            .map(|(id, summary)| {
                Ok(DependencyResult {
                    id: TaskId::new(id)?,
                    summary,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let owning_repair_ids: Vec<String> = row.get("owning_repair_ids")?;
        let owning_repairs = owning_repair_ids
            .into_iter()
            .map(TaskId::new)
            .collect::<Result<Vec<_>, _>>()
            .map_err(anyhow::Error::msg)?;
        let artifact_ids: Vec<String> = row.get("artifact_ids")?;
        let artifact_kinds: Vec<String> = row.get("artifact_kinds")?;
        let artifact_uris: Vec<String> = row.get("artifact_uris")?;
        let artifact_digests: Vec<String> = row.get("artifact_digests")?;
        let artifact_contents: Vec<String> = row.get("artifact_contents")?;
        let dependency_artifacts = artifact_ids
            .into_iter()
            .zip(artifact_kinds)
            .zip(artifact_uris)
            .zip(artifact_digests)
            .zip(artifact_contents)
            .map(|((((id, kind), uri), digest), content)| Artifact {
                id,
                kind,
                uri,
                digest,
                content,
            })
            .collect();

        Ok(ClaimedTask {
            id: TaskId::new(row.get::<String>("id")?)?,
            kind: row.get("kind")?,
            prompt: row.get("prompt")?,
            source_commit: row.get("source_commit")?,
            attempt_number: row.get("attempt_number")?,
            attempt_id,
            lease_token,
            owning_repairs,
            dependency_context,
            dependency_artifacts,
        })
    }
}

#[async_trait]
impl TaskStore for Neo4jTaskStore {
    async fn migrate(&self) -> anyhow::Result<()> {
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
            anyhow::bail!(
                "Hive graph schema {installed_version} is newer than supported version {LATEST_SCHEMA_VERSION}"
            );
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
                anyhow::bail!(
                    "Hive schema 1 contains {legacy_tasks} task(s) without source_commit; \
                     drain or remove those legacy tasks before upgrading to schema 2"
                );
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
                .context("failed to initialize schema-3 manual retry state")?;
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
                .context("failed to initialize schema-4 release-scoped retry state")?;
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
                .context("failed to backfill schema-7 latest activity state")?;
        }
        if installed_version < 8 {
            self.graph
                .run(query(
                    "MATCH (task:Task)
                     WHERE task.obsolete IS NULL
                     SET task.obsolete = false",
                ))
                .await
                .context("failed to backfill schema-8 task retirement state")?;
            self.graph
                .run(query(
                    "MATCH (attempt:Attempt)
                     WHERE attempt.obsolete IS NULL
                     SET attempt.obsolete = false",
                ))
                .await
                .context("failed to backfill schema-8 attempt retirement state")?;
        }
        for statement in CONSTRAINTS {
            self.graph
                .run(query(statement))
                .await
                .with_context(|| format!("failed to apply graph migration: {statement}"))?;
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

    async fn register_agent(&self, agent_id: &AgentId, pod_name: &str) -> anyhow::Result<()> {
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
            .context("failed to register Hive agent")
    }

    async fn enqueue(&self, task: &EnqueueTask) -> anyhow::Result<()> {
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
            anyhow::bail!("task {} already exists", task.id);
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
                .with_context(|| format!("dependency {} does not exist", dependency))?;
            if rows.next(transaction.handle()).await?.is_none() {
                transaction.rollback().await?;
                return Err(anyhow::anyhow!(
                    "dependency {dependency} does not exist or targets a different source commit"
                ));
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
    ) -> anyhow::Result<Option<TaskId>> {
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
            .map(|row| TaskId::new(row.get::<String>("id")?).map_err(anyhow::Error::msg))
            .transpose()
    }

    async fn cancel(&self, task_id: &TaskId, reason: &str) -> anyhow::Result<bool> {
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
    ) -> anyhow::Result<bool> {
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
    ) -> anyhow::Result<Vec<CancellationTarget>> {
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
                task_id: TaskId::new(row.get::<String>("task_id")?).map_err(anyhow::Error::msg)?,
                pod_name: row.get("pod_name")?,
            });
        }
        Ok(targets)
    }

    async fn finalize_cancellation(&self, task_id: &TaskId) -> anyhow::Result<bool> {
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

    async fn claim(&self, agent_id: &AgentId, lease_seconds: i64) -> anyhow::Result<ClaimOutcome> {
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
                Err(error) if transient_claim_retry_delay(retry, &error).is_some() => {
                    tokio::time::sleep(
                        transient_claim_retry_delay(retry, &error)
                            .expect("retry guard proved a delay exists"),
                    )
                    .await;
                }
                Err(error) => return Err(error),
            }
        }
        unreachable!("bounded claim retry loop always returns")
    }

    async fn heartbeat(
        &self,
        task_id: &TaskId,
        agent_id: &AgentId,
        lease_token: &LeaseToken,
        lease_seconds: i64,
    ) -> anyhow::Result<bool> {
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
    ) -> anyhow::Result<bool> {
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

    async fn release(&self, task: &ClaimedTask, agent_id: &AgentId) -> anyhow::Result<bool> {
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
    ) -> anyhow::Result<bool> {
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
                          AND
                          size(active_owners) = size($owning_repair_ids)
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
    ) -> anyhow::Result<bool> {
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
    ) -> anyhow::Result<bool> {
        blocker.validate()?;
        if blocker.source_commit != task.source_commit {
            anyhow::bail!("a blocker must target the same pinned repository revision");
        }
        if !blocker.dependencies.is_empty() {
            anyhow::bail!("a newly discovered blocker must not have undeclared dependencies");
        }
        let mut transaction = self.graph.start_txn().await?;
        let mut edge_rows = transaction
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})
                       <-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND task.lease_until > timestamp()
                       AND attempt.lease_token = $lease_token
                     MERGE (blocker:Task {id: $blocker_id})
                     ON CREATE SET blocker.created_at = timestamp(),
                                   blocker.attempt_count = 0,
                                   blocker.version = 0,
                                   blocker.kind = $blocker_kind,
                                   blocker.trigger_kind = $blocker_trigger_kind,
                                   blocker.prompt = $blocker_prompt,
                                   blocker.source_commit = $source_commit,
                                   blocker.priority = $blocker_priority,
                                   blocker.max_attempts = $blocker_max_attempts,
                                   blocker.status = 'READY',
                                   blocker.obsolete = false,
                                   blocker.updated_at = timestamp()
                     WITH task, blocker
                     WHERE blocker.source_commit = $source_commit
                       AND blocker.id <> task.id
                       AND NOT EXISTS {
                         MATCH (blocker)-[:DEPENDS_ON*1..]->(task)
                       }
                     MERGE (task)-[:DEPENDS_ON]->(blocker)
                     SET blocker.version = coalesce(blocker.version, 0) + 1
                     RETURN blocker.id AS id",
                )
                .param("task_id", task.id.as_str())
                .param("attempt_id", task.attempt_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", task.lease_token.as_str())
                .param("blocker_id", blocker.id.as_str())
                .param("blocker_kind", blocker.kind.as_str())
                .param("blocker_trigger_kind", blocker.trigger.as_str())
                .param("blocker_prompt", blocker.prompt.as_str())
                .param("source_commit", blocker.source_commit.as_str())
                .param("blocker_priority", blocker.priority)
                .param("blocker_max_attempts", blocker.max_attempts),
            )
            .await?;
        let edge_attached = edge_rows.next(transaction.handle()).await?.is_some();
        drop(edge_rows);
        if !edge_attached {
            transaction.rollback().await?;
            return Ok(false);
        }
        let blocker_was_obsolete =
            Self::rearm_obsolete_subtree(&mut transaction, &blocker.id).await?;
        let mut rows = transaction
            .execute(
                query(
                    "MATCH (task:Task {id: $task_id})-[:DEPENDS_ON]->
                       (blocker:Task {id: $blocker_id})
                     MATCH (task)<-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
                     WHERE task.status = 'RUNNING'
                       AND task.lease_owner = $agent_id
                       AND task.lease_token = $lease_token
                       AND task.lease_until > timestamp()
                       AND attempt.lease_token = $lease_token
                     WITH task, attempt, blocker,
                          $blocker_was_obsolete AS blocker_was_obsolete
                     SET task.status = CASE
                             WHEN blocker.status = 'FAILED' THEN 'FAILED'
                             WHEN blocker_was_obsolete THEN 'BLOCKED'
                             WHEN blocker.status = 'COMPLETED' THEN 'READY'
                             ELSE 'BLOCKED'
                         END,
                         task.attempt_count = task.attempt_count - 1,
                         task.blocked_reason = CASE
                           WHEN NOT blocker_was_obsolete
                             AND blocker.status = 'COMPLETED' THEN null
                           ELSE $reason
                         END,
                         task.failure_reason = CASE
                           WHEN blocker.status = 'FAILED'
                           THEN 'discovered blocker has already exhausted its retry budget'
                           ELSE null
                         END,
                         task.updated_at = timestamp(),
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'BLOCKED',
                         attempt.error = $reason,
                         attempt.completed_at = timestamp()
                     WITH task, blocker
                     OPTIONAL MATCH (dependent:Task)-[:DEPENDS_ON*1..]->(task)
                     WITH task, blocker, collect(dependent) AS dependents
                     FOREACH (dependent IN CASE
                       WHEN blocker.status = 'FAILED' THEN dependents
                       ELSE []
                     END |
                       SET dependent.status = 'FAILED',
                           dependent.failure_reason =
                             'upstream task reused an exhausted blocker',
                           dependent.updated_at = timestamp()
                     )
                     WITH task
                     MATCH (agent:Agent {id: $agent_id})
                     SET agent.status = 'IDLE', agent.last_seen_at = timestamp()
                     RETURN task.id AS id",
                )
                .param("task_id", task.id.as_str())
                .param("attempt_id", task.attempt_id.as_str())
                .param("agent_id", agent_id.as_str())
                .param("lease_token", task.lease_token.as_str())
                .param("blocker_id", blocker.id.as_str())
                .param("blocker_was_obsolete", blocker_was_obsolete)
                .param("reason", reason),
            )
            .await?;
        let accepted = rows.next(transaction.handle()).await?.is_some();
        if accepted {
            transaction.commit().await?;
        } else {
            transaction.rollback().await?;
        }
        Ok(accepted)
    }
}
