use neo4rs::{Txn, query};

use crate::model::TaskId;

use super::Neo4jTaskStore;

impl Neo4jTaskStore {
    pub(super) async fn rearm_obsolete_subtree(
        transaction: &mut Txn,
        root_id: &TaskId,
    ) -> crate::HiveResult<bool> {
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
        Ok(true)
    }
}
