MATCH (task:Task)
 WHERE ($attention_only = false AND ($task_id = '' OR task.id = $task_id))
    OR ($attention_only = true
      AND task.status IN ['FAILED', 'BLOCKED', 'RUNNING', 'CANCELLING'])
 OPTIONAL MATCH (task)<-[:FOR_TASK]-(attempt:Attempt)
 OPTIONAL MATCH (agent:Agent)-[:EXECUTED]->(attempt)
 WITH task, attempt, agent
 ORDER BY attempt.started_at DESC
 WITH task, collect({attempt: attempt, agent: agent})[0] AS latest
 WITH task, latest,
   CASE
     WHEN coalesce(task.latest_activity_at, 0)
       >= coalesce(latest.attempt.started_at, 0)
     THEN coalesce(task.latest_activity_at, 0)
     ELSE coalesce(latest.attempt.started_at, task.created_at, 0)
   END AS latest_progress_at
 WHERE $attention_only = false
    OR (
      task.status IN ['FAILED', 'BLOCKED']
      OR (
        task.status = 'RUNNING'
        AND latest_progress_at < timestamp() - $attention_age
      )
      OR (
        task.status = 'CANCELLING'
        AND coalesce(task.updated_at, task.created_at, 0)
          < timestamp() - $attention_age
      )
    )
 RETURN task.id AS id,
        coalesce(task.kind, '') AS kind,
        coalesce(task.trigger_kind, 'legacy-unknown') AS trigger_kind,
        task.status AS status,
        coalesce(task.source_commit, '') AS source_commit,
        coalesce(task.priority, 0) AS priority,
        coalesce(task.attempt_count, 0) AS attempt_count,
        coalesce(task.max_attempts, 0) AS max_attempts,
        coalesce(task.created_at, 0) AS created_at,
        coalesce(task.updated_at, task.created_at, 0) AS updated_at,
        coalesce(task.lease_until, 0) AS lease_until,
        coalesce(latest.agent.id, '') AS agent_id,
        coalesce(latest.agent.pod_name, '') AS pod_name,
        coalesce(latest.attempt.status, '') AS latest_attempt_status,
        coalesce(latest.attempt.started_at, 0) AS latest_attempt_started_at,
        coalesce(latest.attempt.completed_at, 0) AS latest_attempt_completed_at,
        coalesce(task.latest_activity_at, 0) AS latest_activity_at,
        substring(replace(CASE
          WHEN task.status = 'BLOCKED' THEN coalesce(
            task.blocked_reason,
            latest.attempt.error,
            task.failure_reason,
            ''
          )
          ELSE coalesce(
            latest.attempt.error,
            task.failure_reason,
            task.blocked_reason,
            ''
          )
        END, '\n', ' '), 0, 600)
          AS latest_error,
        substring(replace(coalesce(latest.attempt.summary, ''), '\n', ' '), 0, 1200)
          AS latest_summary,
        coalesce(task.blocked_reason, '') STARTS WITH 'dependency '
          OR coalesce(task.blocked_reason, '') STARTS WITH 'upstream dependency '
          OR coalesce(task.failure_reason, '') =
            'discovered blocker has already exhausted its retry budget'
          OR coalesce(task.failure_reason, '') =
            'upstream task reused an exhausted blocker'
          OR coalesce(task.failure_reason, '') =
            'dependency failed before task enqueue'
          AS dependency_failure
 ORDER BY
   CASE WHEN $attention_only = true THEN
     CASE task.status
       WHEN 'FAILED' THEN 0
       ELSE 1
     END
   ELSE
     CASE task.status
       WHEN 'RUNNING' THEN 0
       WHEN 'READY' THEN 1
       WHEN 'BLOCKED' THEN 2
       WHEN 'CANCELLING' THEN 3
       ELSE 4
     END
   END,
   CASE WHEN task.status = 'READY' THEN task.priority ELSE 0 END DESC,
   CASE WHEN task.status = 'READY' THEN task.created_at ELSE 0 END ASC,
   CASE WHEN task.status = 'READY' THEN task.id ELSE '' END ASC,
   CASE
     WHEN $attention_only = true
       AND task.status = 'FAILED'
       AND dependency_failure
       THEN coalesce(task.updated_at, task.created_at, 0)
     WHEN $attention_only = true AND task.status = 'FAILED'
       THEN coalesce(latest.attempt.completed_at, task.updated_at, task.created_at, 0)
     WHEN $attention_only = true AND task.status = 'RUNNING'
       THEN latest_progress_at + $attention_age
     WHEN $attention_only = true AND task.status = 'CANCELLING'
       THEN coalesce(task.updated_at, task.created_at, 0) + $attention_age
     WHEN $attention_only = true
       THEN coalesce(task.updated_at, task.created_at, 0)
     ELSE 0
   END ASC,
   updated_at DESC,
   created_at DESC
 LIMIT $limit
