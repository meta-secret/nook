use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use neo4rs::{ConfigBuilder, Error as Neo4jDriverError, Graph, Neo4jErrorKind, Row, query};
use rand::RngExt;
use serde::Serialize;
use uuid::Uuid;

use crate::install_rustls_crypto_provider;
use crate::model::{
    AgentId, Artifact, AttemptId, ClaimedTask, DependencyResult, EnqueueTask, LeaseToken, TaskId,
};
use crate::store::TaskStore;

const CONSTRAINTS: &[&str] = &[
    "CREATE CONSTRAINT hive_task_id IF NOT EXISTS FOR (node:Task) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_agent_id IF NOT EXISTS FOR (node:Agent) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_attempt_id IF NOT EXISTS FOR (node:Attempt) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_artifact_id IF NOT EXISTS FOR (node:Artifact) REQUIRE node.id IS UNIQUE",
    "CREATE INDEX hive_task_claim IF NOT EXISTS FOR (node:Task) ON (node.status, node.priority, node.created_at)",
];
const LATEST_SCHEMA_VERSION: i64 = 4;
const CLAIM_RETRY_LIMIT: usize = 5;

fn is_transient_claim_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<Neo4jDriverError>()
            .is_some_and(|driver_error| match driver_error {
                Neo4jDriverError::Neo4j(neo4j_error) => {
                    neo4j_error.kind() == Neo4jErrorKind::Transient
                }
                Neo4jDriverError::UnexpectedMessage(message) => {
                    message.contains("Neo.TransientError.")
                }
                _ => false,
            })
    })
}

fn transient_claim_retry_delay(retry: usize, error: &anyhow::Error) -> Option<Duration> {
    (retry + 1 < CLAIM_RETRY_LIMIT && is_transient_claim_error(error))
        .then(|| Duration::from_millis(rand::rng().random_range(20..=80)))
}

#[derive(Clone)]
pub struct Neo4jTaskStore {
    graph: Graph,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QueueTaskStatus {
    pub id: String,
    pub status: String,
    pub attempt_count: i64,
    pub max_attempts: i64,
    pub latest_attempt_status: String,
    pub latest_error: String,
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
                     WITH task, collect(attempt)[0] AS latest
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
        let mut rows = self
            .graph
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
                .param("release_id", format!("sha256:{digest}")),
            )
            .await?;
        Ok(rows.next().await?.is_some())
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
                    id: TaskId::new(id).map_err(anyhow::Error::msg)?,
                    summary,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
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
            id: TaskId::new(row.get::<String>("id")?).map_err(anyhow::Error::msg)?,
            kind: row.get("kind")?,
            prompt: row.get("prompt")?,
            source_commit: row.get("source_commit")?,
            attempt_number: row.get("attempt_number")?,
            attempt_id,
            lease_token,
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
                     SET task.last_retry_release = ''
                     REMOVE task.manual_retry_used",
                ))
                .await
                .context("failed to initialize schema-4 release-scoped retry state")?;
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
        task.validate().map_err(anyhow::Error::msg)?;
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
                                   task.enqueue_token = $enqueue_token,
                                   task.kind = $kind,
                                   task.prompt = $prompt,
                                   task.source_commit = $source_commit,
                                   task.priority = $priority,
                                   task.max_attempts = $max_attempts,
                                   task.updated_at = timestamp()
                     RETURN task.enqueue_token = $enqueue_token AS created",
                )
                .param("id", task.id.as_str())
                .param("enqueue_token", enqueue_token.as_str())
                .param("kind", task.kind.as_str())
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
        }

        transaction
            .run(
                query(
                    "MATCH (task:Task {id: $id})
                     OPTIONAL MATCH (task)-[:DEPENDS_ON]->(dependency:Task)
                     WITH task, count(dependency) AS dependency_count,
                          count(CASE WHEN dependency.status = 'COMPLETED' THEN 1 END) AS completed_count
                     SET task.status = CASE
                       WHEN dependency_count = completed_count THEN 'READY'
                       ELSE 'BLOCKED'
                     END",
                )
                .param("id", task.id.as_str()),
            )
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn claim(
        &self,
        agent_id: &AgentId,
        lease_seconds: i64,
    ) -> anyhow::Result<Option<ClaimedTask>> {
        for retry in 0..CLAIM_RETRY_LIMIT {
            let result = async {
                let attempt_id =
                    AttemptId::new(Uuid::new_v4().to_string()).map_err(anyhow::Error::msg)?;
                let lease_token =
                    LeaseToken::new(Uuid::new_v4().to_string()).map_err(anyhow::Error::msg)?;
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
                    return Ok(None);
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
                       started_at: timestamp(),
                       lease_token: $lease_token
                     })
                     WITH task, attempt, dependency_ids, dependency_summaries,
                          artifact_ids, artifact_kinds, artifact_uris, artifact_digests,
                          artifact_contents
                     MATCH (agent:Agent {id: $agent_id})
                     MERGE (agent)-[:EXECUTED]->(attempt)
                     MERGE (attempt)-[:FOR_TASK]->(task)
                     SET agent.status = 'RUNNING', agent.last_seen_at = timestamp()
                     RETURN task.id AS id,
                            task.kind AS kind,
                            task.prompt AS prompt,
                            task.source_commit AS source_commit,
                            attempt.number AS attempt_number,
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
                    return Ok(None);
                };
                let claimed = Self::claimed_task(row, attempt_id, lease_token)?;
                transaction.commit().await?;
                Ok(Some(claimed))
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
        summary: &str,
        artifact: Option<&Artifact>,
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
                     SET task.status = 'COMPLETED',
                         task.result_summary = $summary,
                         task.updated_at = timestamp(),
                         task.lease_owner = null,
                         task.lease_token = null,
                         task.lease_until = null,
                         attempt.status = 'COMPLETED',
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
                .param("summary", summary),
            )
            .await?;
        let accepted = rows.next(transaction.handle()).await?.is_some();
        if !accepted {
            transaction.rollback().await?;
            return Ok(false);
        }

        if let Some(artifact) = artifact {
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
        blocker.validate().map_err(anyhow::Error::msg)?;
        if blocker.source_commit != task.source_commit {
            anyhow::bail!("a blocker must target the same pinned repository revision");
        }
        if !blocker.dependencies.is_empty() {
            anyhow::bail!("a newly discovered blocker must not have undeclared dependencies");
        }
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
                     MERGE (blocker:Task {id: $blocker_id})
                     ON CREATE SET blocker.created_at = timestamp(),
                                   blocker.attempt_count = 0,
                                   blocker.version = 0,
                                   blocker.kind = $blocker_kind,
                                   blocker.prompt = $blocker_prompt,
                                   blocker.source_commit = $source_commit,
                                   blocker.priority = $blocker_priority,
                                   blocker.max_attempts = $blocker_max_attempts,
                                   blocker.status = 'READY',
                                   blocker.updated_at = timestamp()
                     WITH task, attempt, blocker
                     WHERE blocker.source_commit = $source_commit
                       AND blocker.id <> task.id
                       AND NOT EXISTS {
                         MATCH (blocker)-[:DEPENDS_ON*1..]->(task)
                       }
                     MERGE (task)-[:DEPENDS_ON]->(blocker)
                     SET task.status = CASE
                             WHEN blocker.status = 'COMPLETED' THEN 'READY'
                             WHEN blocker.status = 'FAILED' THEN 'FAILED'
                             ELSE 'BLOCKED'
                         END,
                         task.attempt_count = task.attempt_count - 1,
                         task.blocked_reason = $reason,
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
                .param("blocker_kind", blocker.kind.as_str())
                .param("blocker_prompt", blocker.prompt.as_str())
                .param("source_commit", blocker.source_commit.as_str())
                .param("blocker_priority", blocker.priority)
                .param("blocker_max_attempts", blocker.max_attempts)
                .param("reason", reason),
            )
            .await?;
        Ok(rows.next().await?.is_some())
    }
}

#[cfg(test)]
mod tests {
    use std::env;

    use neo4rs::{Error as Neo4jDriverError, query};
    use uuid::Uuid;

    use super::{
        CLAIM_RETRY_LIMIT, Neo4jTaskStore, is_transient_claim_error, transient_claim_retry_delay,
    };
    use crate::model::{AgentId, Artifact, EnqueueTask, TaskId};
    use crate::store::TaskStore;

    fn task(id: String, dependencies: Vec<TaskId>) -> EnqueueTask {
        EnqueueTask {
            id: TaskId::new(id).expect("valid task id"),
            kind: "integration".to_owned(),
            prompt: "Exercise the production task store".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            priority: 0,
            max_attempts: 3,
            dependencies,
        }
    }

    #[test]
    fn retries_transient_pull_failures_from_the_neo4j_driver() {
        let transient = anyhow::Error::new(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.TransientError.Transaction.DeadlockDetected"
                .to_owned(),
        ));
        let permanent = anyhow::Error::new(Neo4jDriverError::UnexpectedMessage(
            "unexpected response for PULL: Neo.ClientError.Statement.SyntaxError".to_owned(),
        ));

        assert!(is_transient_claim_error(&transient));
        assert!(!is_transient_claim_error(&permanent));
        assert!(transient_claim_retry_delay(0, &transient).is_some());
        assert!(transient_claim_retry_delay(CLAIM_RETRY_LIMIT - 2, &transient).is_some());
        assert!(transient_claim_retry_delay(CLAIM_RETRY_LIMIT - 1, &transient).is_none());
        assert!(transient_claim_retry_delay(0, &permanent).is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn production_store_enforces_claims_dependencies_and_stale_leases() {
        let Ok(uri) = env::var("HIVE_NEO4J_TEST_URI") else {
            return;
        };
        let username = env::var("HIVE_NEO4J_TEST_USERNAME").unwrap_or_else(|_| "neo4j".to_owned());
        let password = env::var("HIVE_NEO4J_TEST_PASSWORD")
            .expect("HIVE_NEO4J_TEST_PASSWORD is required with HIVE_NEO4J_TEST_URI");
        let store = Neo4jTaskStore::connect(&uri, &username, &password)
            .await
            .expect("connect to integration Neo4j");
        store.migrate().await.expect("migrate production store");
        store
            .graph
            .run(query("MATCH (node) DETACH DELETE node"))
            .await
            .expect("clear isolated integration database");

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
            .expect("dependency available");
        assert_eq!(dependency_claim.id, dependency.id);
        assert!(
            store
                .claim(&agent_b, 300)
                .await
                .expect("blocked claim")
                .is_none(),
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
                    "dependency complete",
                    Some(&artifact),
                )
                .await
                .expect("complete dependency")
        );
        let mut artifact_rows = store
            .graph
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
            (Some(claim), None) => (claim, &agent_b, &agent_c),
            (None, Some(claim)) => (claim, &agent_c, &agent_b),
            _ => panic!("only one worker may win a claim"),
        };
        assert_eq!(
            stale_claim.dependency_artifacts,
            vec![artifact.clone()],
            "a dependent task must receive the completed dependency patch"
        );

        store
            .graph
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
                .complete(&stale_claim, stale_agent, "stale completion", None)
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
                    "retry complete",
                    Some(&dependent_artifact),
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
            .expect("descendant available");
        assert_eq!(
            descendant_claim.dependency_artifacts,
            vec![artifact.clone(), dependent_artifact],
            "transitive dependency patches must be returned in ancestor-first order"
        );
        assert!(
            store
                .complete(&descendant_claim, &agent_a, "descendant complete", None)
                .await
                .expect("complete descendant")
        );

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
                    .complete(&claim, &agent_a, "branch complete", Some(&branch_artifact))
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
        assert!(
            store
                .complete(&diamond_claim, &agent_a, "diamond complete", None)
                .await
                .expect("complete diamond")
        );

        let mut rows = store
            .graph
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
            .expect("released task available");
        assert_eq!(resumed.attempt_number, 1);
        assert!(
            store
                .complete(&resumed, &agent_b, "rollout recovery complete", None)
                .await
                .expect("complete released task")
        );
        let mut rollout_rows = store
            .graph
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
            .expect("blocker available");
        assert_eq!(blocker_claim.id, blocker.id);
        assert!(
            store
                .complete(&blocker_claim, &agent_a, "blocker complete", None)
                .await
                .expect("complete blocker")
        );
        let resumed_original = store
            .claim(&agent_a, 300)
            .await
            .expect("resume original")
            .expect("original resumed");
        assert_eq!(resumed_original.id, original.id);
        assert_eq!(resumed_original.attempt_number, 1);
        assert!(
            store
                .complete(&resumed_original, &agent_a, "original complete", None)
                .await
                .expect("complete resumed original")
        );

        let reused = task(format!("reused-blocker-original-{suffix}"), Vec::new());
        store
            .enqueue(&reused)
            .await
            .expect("enqueue reused original");
        let reused_claim = store
            .claim(&agent_a, 300)
            .await
            .expect("claim reused original")
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
        let resumed_reused = store
            .claim(&agent_a, 300)
            .await
            .expect("resume task with completed blocker")
            .expect("task with completed blocker is ready");
        assert_eq!(resumed_reused.id, reused.id);
        assert_eq!(resumed_reused.attempt_number, 1);
        assert!(
            store
                .complete(
                    &resumed_reused,
                    &agent_a,
                    "completed reused-blocker task",
                    None,
                )
                .await
                .expect("complete reused-blocker task")
        );

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
        assert!(
            store
                .complete(&cycle_claim, &agent_a, "cycle root complete", None)
                .await
                .expect("complete cycle root")
        );
        let cycle_dependent_claim = store
            .claim(&agent_a, 300)
            .await
            .expect("claim cycle dependent")
            .expect("cycle dependent available");
        assert!(
            store
                .complete(
                    &cycle_dependent_claim,
                    &agent_a,
                    "cycle dependent complete",
                    None,
                )
                .await
                .expect("complete cycle dependent")
        );

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
            .expect("exhausted task available");
        assert!(
            store
                .fail(&exhausted_claim, &agent_a, "terminal failure")
                .await
                .expect("fail exhausted task")
        );
        let mut failed_rows = store
            .graph
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

        let mut repair = task(format!("main-failure-{suffix}"), Vec::new());
        repair.kind = "main-repair".to_owned();
        repair.max_attempts = 1;
        store.enqueue(&repair).await.expect("enqueue Main repair");
        let repair_claim = store
            .claim(&agent_a, 300)
            .await
            .expect("claim Main repair")
            .expect("Main repair available");
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
            let retried_claim = store
                .claim(&agent_a, 300)
                .await
                .expect("claim retried Main repair")
                .expect("retried Main repair available");
            assert_eq!(retried_claim.id, repair.id);
            assert_eq!(retried_claim.attempt_number, attempt_number);
            assert!(
                store
                    .fail(&retried_claim, &agent_a, "repair attempt failed")
                    .await
                    .expect("fail retried Main repair")
            );
        }
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
            .expect("repair available on release b");
        assert_eq!(release_b_claim.id, repair.id);
        assert_eq!(release_b_claim.attempt_number, 5);
        assert!(
            store
                .complete(&release_b_claim, &agent_a, "platform repaired", None)
                .await
                .expect("complete repair on release b")
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
        let mut reused_failed_rows = store
            .graph
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
            .expect("recovered blocker available");
        assert_eq!(recovered_blocker.id, exhausted.id);
        assert!(
            store
                .complete(
                    &recovered_blocker,
                    &agent_a,
                    "sandbox dependency repaired",
                    None,
                )
                .await
                .expect("complete recovered blocker")
        );
        let recovered_parent = store
            .claim(&agent_a, 300)
            .await
            .expect("claim recovered parent")
            .expect("recovered parent available");
        assert_eq!(recovered_parent.id, reused_failed_parent.id);
        assert!(
            store
                .complete(
                    &recovered_parent,
                    &agent_a,
                    "dependent repair complete",
                    None,
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
            .expect("expired blocker parent available");
        store
            .graph
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
        store
            .graph
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
            .expect("final-lease task available");
        assert_eq!(lease_claim.id, lease_exhausted.id);
        store
            .graph
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
                .is_none()
        );
        let mut lease_failed_rows = store
            .graph
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

        store
            .graph
            .run(query("MATCH (node) DETACH DELETE node"))
            .await
            .expect("clean isolated integration database");
        store
            .graph
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
        store
            .graph
            .run(query("MATCH (node) DETACH DELETE node"))
            .await
            .expect("clean schema migration fixture");
        store
            .graph
            .run(query(
                "CREATE (:HiveSchemaMigration {version: 3})
                 CREATE (:Task {
                   id: 'schema-3-task',
                   status: 'FAILED',
                   manual_retry_used: true,
                   source_commit: '0123456789abcdef0123456789abcdef01234567'
                 })",
            ))
            .await
            .expect("create schema-3 fixture");
        store.migrate().await.expect("migrate schema 3 to schema 4");
        let mut schema_four_rows = store
            .graph
            .execute(query(
                "MATCH (task:Task {id: 'schema-3-task'})
                 MATCH (migration:HiveSchemaMigration {version: 4})
                 RETURN task.last_retry_release AS last_retry_release,
                        task.manual_retry_used IS NULL AS removed_legacy_marker,
                        migration.version AS version",
            ))
            .await
            .expect("read schema-4 migration state");
        let schema_four = schema_four_rows
            .next()
            .await
            .expect("read schema-4 row")
            .expect("schema-4 migration row");
        assert_eq!(
            schema_four
                .get::<String>("last_retry_release")
                .expect("initialized release marker"),
            ""
        );
        assert!(
            schema_four
                .get::<bool>("removed_legacy_marker")
                .expect("removed legacy marker")
        );
        assert_eq!(
            schema_four.get::<i64>("version").expect("schema-4 version"),
            4
        );
        store
            .graph
            .run(query("MATCH (node) DETACH DELETE node"))
            .await
            .expect("clean schema-4 migration fixture");
    }
}
