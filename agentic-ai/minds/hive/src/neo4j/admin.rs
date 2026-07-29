use super::*;

impl Neo4jTaskStore {
    pub async fn connect(uri: &str, username: &str, password: &str) -> crate::HiveResult<Self> {
        install_rustls_crypto_provider()?;
        let config = ConfigBuilder::default()
            .uri(uri)
            .user(username)
            .password(password)
            .db("neo4j")
            .build()
            .hive_context("invalid Neo4j configuration")?;
        let graph = Graph::connect(config)
            .await
            .hive_context("failed to connect to Neo4j")?;
        Ok(Self { graph })
    }

    pub async fn queue_status(&self, limit: i64) -> crate::HiveResult<Vec<QueueTaskStatus>> {
        if !(1..=200).contains(&limit) {
            crate::hive_bail!("queue status limit must be between 1 and 200");
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
    ) -> crate::HiveResult<bool> {
        let digest = release_id
            .strip_prefix("sha256:")
            .filter(|digest| {
                digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
            .hive_context("release id must be a sha256 digest")?;
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

    pub(super) fn claimed_task(
        row: Row,
        attempt_id: AttemptId,
        lease_token: LeaseToken,
    ) -> crate::HiveResult<ClaimedTask> {
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
            .collect::<crate::HiveResult<Vec<_>>>()?;
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
            dependency_context,
            dependency_artifacts,
        })
    }
}
