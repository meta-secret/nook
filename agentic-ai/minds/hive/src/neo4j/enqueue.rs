use crate::HiveContext;
use neo4rs::query;
use uuid::Uuid;

use crate::model::{ActiveDelivery, ActiveDeliveryQuery, EnqueueTask, TaskId};

use super::Neo4jTaskStore;

impl Neo4jTaskStore {
    pub(super) async fn enqueue_task(&self, task: &EnqueueTask) -> crate::HiveResult<()> {
        task.validate()?;
        let (origin_main_sha, pinned_local_dev_sha, feature_branch) = task
            .bootstrap_evidence
            .as_ref()
            .map_or(("", "", ""), |evidence| {
                (
                    evidence.origin_main_sha.as_str(),
                    evidence.pinned_local_dev_sha.as_str(),
                    evidence.feature_branch.as_str(),
                )
            });
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
                                   task.origin_main_sha = $origin_main_sha,
                                   task.pinned_local_dev_sha = $pinned_local_dev_sha,
                                   task.feature_branch = $feature_branch,
                                   task.priority = $priority,
                                   task.max_attempts = $max_attempts,
                                   task.status = 'BLOCKED',
                                   task.updated_at = timestamp()
                     RETURN task.enqueue_token = $enqueue_token AS created,
                            task.source_commit AS existing_source_commit,
                            coalesce(task.origin_main_sha, '') AS origin_main_sha,
                            coalesce(task.pinned_local_dev_sha, '') AS pinned_local_dev_sha,
                            coalesce(task.feature_branch, '') AS feature_branch",
                )
                .param("id", task.id.as_str())
                .param("enqueue_token", enqueue_token.as_str())
                .param("kind", task.kind.as_str())
                .param("trigger_kind", task.trigger.as_str())
                .param("prompt", task.prompt.as_str())
                .param("source_commit", task.source_commit.as_str())
                .param("origin_main_sha", origin_main_sha)
                .param("pinned_local_dev_sha", pinned_local_dev_sha)
                .param("feature_branch", feature_branch)
                .param("priority", task.priority)
                .param("max_attempts", task.max_attempts),
            )
            .await?;
        let row = rows
            .next(transaction.handle())
            .await?
            .ok_or_else(|| crate::HiveError::message("task enqueue returned no row"))?;
        let created = row.get::<bool>("created")?;
        if !created {
            let existing_source_commit = row.get::<String>("existing_source_commit")?;
            let existing_bootstrap_evidence = Self::bootstrap_evidence(&row)?;
            let evidence_matches = task.bootstrap_evidence.as_ref().map_or(
                existing_bootstrap_evidence.is_none(),
                |evidence| evidence.matches(existing_bootstrap_evidence.as_ref()),
            );
            transaction.rollback().await?;
            if existing_source_commit != task.source_commit || !evidence_matches {
                return Err(crate::HiveError::message(format!(
                    "task {} already exists with different source commit or bootstrap evidence",
                    task.id
                )));
            }
            return Ok(());
        }

        for dependency in &task.dependencies {
            let mut rows = transaction
                .execute(
                    query(
                        "MATCH (task:Task {id: $id}), (dependency:Task {id: $dependency})
                         WHERE dependency.source_commit = task.source_commit
                           AND coalesce(dependency.origin_main_sha, '') = task.origin_main_sha
                           AND coalesce(dependency.pinned_local_dev_sha, '') = task.pinned_local_dev_sha
                           AND coalesce(dependency.feature_branch, '') = task.feature_branch
                         MERGE (task)-[:DEPENDS_ON]->(dependency)
                         SET dependency.version = coalesce(dependency.version, 0) + 1
                         RETURN dependency.id AS id",
                    )
                    .param("id", task.id.as_str())
                    .param("dependency", dependency.as_str()),
                )
                .await
                .with_hive_context(|| format!("dependency {dependency} does not exist"))?;
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
        request: ActiveDeliveryQuery<'_>,
    ) -> crate::HiveResult<ActiveDelivery> {
        let ActiveDeliveryQuery {
            source_commit,
            kind,
            bootstrap_evidence,
        } = request;
        let (origin_main_sha, pinned_local_dev_sha, feature_branch) = bootstrap_evidence
            .map_or(("", "", ""), |evidence| {
                (
                    evidence.origin_main_sha.as_str(),
                    evidence.pinned_local_dev_sha.as_str(),
                    evidence.feature_branch.as_str(),
                )
            });
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (root:Task {source_commit: $source_commit, kind: $kind})
                     WHERE coalesce(root.origin_main_sha, '') = $origin_main_sha
                       AND coalesce(root.pinned_local_dev_sha, '') = $pinned_local_dev_sha
                       AND coalesce(root.feature_branch, '') = $feature_branch
                       AND (
                         root.status IN ['READY', 'RUNNING', 'CANCELLING', 'BLOCKED']
                         OR EXISTS {
                           MATCH (root)-[:DEPENDS_ON*1..]->(descendant:Task)
                           WHERE descendant.status = 'CANCELLING'
                         }
                       )
                     RETURN root.id AS id
                     ORDER BY root.created_at
                     LIMIT 1",
                )
                .param("source_commit", source_commit)
                .param("kind", kind.as_str())
                .param("origin_main_sha", origin_main_sha)
                .param("pinned_local_dev_sha", pinned_local_dev_sha)
                .param("feature_branch", feature_branch),
            )
            .await?;
        match rows.next().await? {
            Some(row) => Ok(ActiveDelivery::Active(TaskId::try_from(
                row.get::<String>("id")?,
            )?)),
            None => Ok(ActiveDelivery::Idle),
        }
    }
}
