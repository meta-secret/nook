use neo4rs::query;

use crate::model::{AgentId, ClaimedTask, EnqueueTask};

use super::Neo4jTaskStore;

impl Neo4jTaskStore {
    pub(super) async fn block_task(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        blocker: &EnqueueTask,
        reason: &str,
    ) -> crate::HiveResult<bool> {
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
        drop(rows);
        if accepted {
            transaction.commit().await?;
        } else {
            transaction.rollback().await?;
        }
        Ok(accepted)
    }
}
