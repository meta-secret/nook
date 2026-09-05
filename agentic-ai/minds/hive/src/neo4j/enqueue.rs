use crate::HiveContext;
use neo4rs::query;
use uuid::Uuid;

use crate::model::{EnqueueTask, TaskId};

use super::Neo4jTaskStore;

impl Neo4jTaskStore {
    pub(super) async fn enqueue_task(&self, task: &EnqueueTask) -> crate::HiveResult<()> {
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
            return Err(crate::HiveError::message(format!(
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
                return Err(crate::HiveError::message(format!(
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

    pub(super) async fn active_delivery_task(
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
}
