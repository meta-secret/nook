MATCH (task:Task {id: $id})
 WHERE (
   task.status = 'READY'
   OR (task.status = 'RUNNING' AND task.lease_until <= timestamp())
 )
   AND task.attempt_count < task.max_attempts
   AND NOT EXISTS {
     MATCH (task)-[:DEPENDS_ON]->(dependency:Task)
     WHERE dependency.status <> 'COMPLETED'
   }
 OPTIONAL MATCH
   (task)-[:DEPENDS_ON|INCLUDES_ARTIFACT_FROM]->(dependency:Task)
 WITH task,
      [value IN collect(dependency.id) WHERE value IS NOT NULL] AS dependency_ids,
      [value IN collect(coalesce(dependency.result_summary, '')) WHERE value IS NOT NULL] AS dependency_summaries
 OPTIONAL MATCH dependency_path =
   (task)-[:DEPENDS_ON|INCLUDES_ARTIFACT_FROM*1..]->(artifact_task:Task)
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
        artifact_contents
