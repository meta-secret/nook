use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use neo4rs::{ConfigBuilder, Error as Neo4jDriverError, Graph, Neo4jErrorKind, Row, query};
use rand::RngExt;
use uuid::Uuid;

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
const LATEST_SCHEMA_VERSION: i64 = 1;
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

impl Neo4jTaskStore {
    pub async fn connect(uri: &str, username: &str, password: &str) -> anyhow::Result<Self> {
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
                                   task.version = 0,
                                   task.enqueue_token = $enqueue_token,
                                   task.kind = $kind,
                                   task.prompt = $prompt,
                                   task.priority = $priority,
                                   task.max_attempts = $max_attempts,
                                   task.updated_at = timestamp()
                     RETURN task.enqueue_token = $enqueue_token AS created",
                )
                .param("id", task.id.as_str())
                .param("enqueue_token", enqueue_token.as_str())
                .param("kind", task.kind.as_str())
                .param("prompt", task.prompt.as_str())
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
                return Err(anyhow::anyhow!("dependency {dependency} does not exist"));
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
                    transaction.rollback().await?;
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
        let mut rows = self
            .graph
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

        store
            .graph
            .run(query("MATCH (node) DETACH DELETE node"))
            .await
            .expect("clean isolated integration database");
    }
}
