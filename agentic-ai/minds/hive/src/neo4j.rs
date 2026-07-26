use anyhow::Context;
use async_trait::async_trait;
use neo4rs::{ConfigBuilder, Graph, Row, query};
use uuid::Uuid;

use crate::model::{
    AgentId, AttemptId, ClaimedTask, DependencyResult, EnqueueTask, LeaseToken, TaskId,
};
use crate::store::TaskStore;

const CONSTRAINTS: &[&str] = &[
    "CREATE CONSTRAINT hive_task_id IF NOT EXISTS FOR (node:Task) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_agent_id IF NOT EXISTS FOR (node:Agent) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_attempt_id IF NOT EXISTS FOR (node:Attempt) REQUIRE node.id IS UNIQUE",
    "CREATE CONSTRAINT hive_artifact_id IF NOT EXISTS FOR (node:Artifact) REQUIRE node.id IS UNIQUE",
    "CREATE INDEX hive_task_claim IF NOT EXISTS FOR (node:Task) ON (node.status, node.priority, node.created_at)",
];

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

        Ok(ClaimedTask {
            id: TaskId::new(row.get::<String>("id")?).map_err(anyhow::Error::msg)?,
            kind: row.get("kind")?,
            prompt: row.get("prompt")?,
            attempt_number: row.get("attempt_number")?,
            attempt_id,
            lease_token,
            dependency_context,
        })
    }
}

#[async_trait]
impl TaskStore for Neo4jTaskStore {
    async fn migrate(&self) -> anyhow::Result<()> {
        for statement in CONSTRAINTS {
            self.graph
                .run(query(statement))
                .await
                .with_context(|| format!("failed to apply graph migration: {statement}"))?;
        }
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
        transaction
            .run(
                query(
                    "MERGE (task:Task {id: $id})
                     ON CREATE SET task.created_at = timestamp(),
                                   task.attempt_count = 0,
                                   task.version = 0
                     SET task.kind = $kind,
                         task.prompt = $prompt,
                         task.priority = $priority,
                         task.max_attempts = $max_attempts,
                         task.updated_at = timestamp()
                     WITH task
                     OPTIONAL MATCH (task)-[old:DEPENDS_ON]->()
                     DELETE old",
                )
                .param("id", task.id.as_str())
                .param("kind", task.kind.as_str())
                .param("prompt", task.prompt.as_str())
                .param("priority", task.priority)
                .param("max_attempts", task.max_attempts),
            )
            .await?;

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
        let attempt_id = AttemptId::new(Uuid::new_v4().to_string()).map_err(anyhow::Error::msg)?;
        let lease_token =
            LeaseToken::new(Uuid::new_v4().to_string()).map_err(anyhow::Error::msg)?;
        let mut transaction = self.graph.start_txn().await?;

        transaction
            .run(query(
                "MATCH (task:Task)
                 WHERE task.status = 'RUNNING'
                   AND task.lease_until <= timestamp()
                   AND task.attempt_count >= task.max_attempts
                 SET task.status = 'FAILED',
                     task.updated_at = timestamp(),
                     task.lease_owner = null,
                     task.lease_token = null,
                     task.lease_until = null",
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
                     SET task.status = 'RUNNING',
                         task.lease_owner = $agent_id,
                         task.lease_token = $lease_token,
                         task.lease_until = timestamp() + ($lease_seconds * 1000),
                         task.attempt_count = task.attempt_count + 1,
                         task.version = task.version + 1,
                         task.updated_at = timestamp()
                     CREATE (attempt:Attempt {
                       id: $attempt_id,
                       number: task.attempt_count,
                       status: 'RUNNING',
                       started_at: timestamp(),
                       lease_token: $lease_token
                     })
                     WITH task, attempt, dependency_ids, dependency_summaries
                     MATCH (agent:Agent {id: $agent_id})
                     MERGE (agent)-[:EXECUTED]->(attempt)
                     MERGE (attempt)-[:FOR_TASK]->(task)
                     SET agent.status = 'RUNNING', agent.last_seen_at = timestamp()
                     RETURN task.id AS id,
                            task.kind AS kind,
                            task.prompt AS prompt,
                            attempt.number AS attempt_number,
                            dependency_ids,
                            dependency_summaries",
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

    async fn complete(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        summary: &str,
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
