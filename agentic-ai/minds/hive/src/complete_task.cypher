MATCH (task:Task {id: $task_id})<-[:FOR_TASK]-(attempt:Attempt {id: $attempt_id})
 WHERE task.status = 'RUNNING'
   AND task.lease_owner = $agent_id
   AND task.lease_token = $lease_token
   AND task.lease_until > timestamp()
   AND attempt.lease_token = $lease_token
 OPTIONAL MATCH (active_owner:Task)-[:DEPENDS_ON*1..]->(task)
 WHERE active_owner.kind <> 'blocker'
   AND active_owner.status IN ['READY', 'RUNNING', 'CANCELLING', 'BLOCKED']
 WITH task, attempt, collect(DISTINCT active_owner) AS active_owners
 WHERE NOT $obsolete
    OR (
      size($owning_repair_ids) > 0
      AND size(active_owners) = size($owning_repair_ids)
      AND all(
        owner IN active_owners
        WHERE owner.kind = 'main-repair'
          AND owner.id IN $owning_repair_ids
      )
    )
 SET task.status = 'COMPLETED',
     task.obsolete = $obsolete,
     task.result_summary = $summary,
     task.updated_at = timestamp(),
     task.lease_owner = null,
     task.lease_token = null,
     task.lease_until = null,
     attempt.status = 'COMPLETED',
     attempt.obsolete = $obsolete,
     attempt.summary = $summary,
     attempt.completed_at = timestamp()
 WITH task
 MATCH (agent:Agent {id: $agent_id})
 SET agent.status = 'IDLE', agent.last_seen_at = timestamp()
 RETURN task.id AS id
