use async_trait::async_trait;

use crate::model::{
    AgentId, CancellationTarget, ClaimOutcome, ClaimedTask, CompletionArtifact, EnqueueTask,
    LeaseToken, TaskActivity, TaskId,
};

#[async_trait]
pub trait TaskStore: Clone + Send + Sync + 'static {
    async fn migrate(&self) -> anyhow::Result<()>;

    async fn register_agent(&self, agent_id: &AgentId, pod_name: &str) -> anyhow::Result<()>;

    async fn enqueue(&self, task: &EnqueueTask) -> anyhow::Result<()>;

    async fn active_delivery(
        &self,
        source_commit: &str,
        kind: &str,
    ) -> anyhow::Result<Option<TaskId>>;

    async fn cancel(&self, task_id: &TaskId, reason: &str) -> anyhow::Result<bool>;

    async fn cancellation_targets(
        &self,
        task_id: &TaskId,
    ) -> anyhow::Result<Vec<CancellationTarget>>;

    async fn finalize_cancellation(&self, task_id: &TaskId) -> anyhow::Result<bool>;

    async fn acknowledge_cancellation(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
    ) -> anyhow::Result<bool>;

    async fn claim(&self, agent_id: &AgentId, lease_seconds: i64) -> anyhow::Result<ClaimOutcome>;

    async fn heartbeat(
        &self,
        task_id: &TaskId,
        agent_id: &AgentId,
        lease_token: &LeaseToken,
        lease_seconds: i64,
    ) -> anyhow::Result<bool>;

    async fn record_activity(
        &self,
        _task: &ClaimedTask,
        _agent_id: &AgentId,
        _activity: &TaskActivity,
    ) -> anyhow::Result<bool> {
        Ok(false)
    }

    async fn release(&self, task: &ClaimedTask, agent_id: &AgentId) -> anyhow::Result<bool>;

    async fn complete(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        summary: &str,
        artifact: &CompletionArtifact,
    ) -> anyhow::Result<bool>;

    async fn fail(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        error: &str,
    ) -> anyhow::Result<bool>;

    async fn block(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        blocker: &EnqueueTask,
        reason: &str,
    ) -> anyhow::Result<bool>;
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use async_trait::async_trait;
    use uuid::Uuid;

    use super::TaskStore;
    use crate::model::{
        AgentId, AttemptId, CancellationTarget, ClaimOutcome, ClaimedTask, CompletionArtifact,
        EnqueueTask, LeaseToken, TaskActivity, TaskId, TaskTrigger,
    };

    #[derive(Debug, Clone)]
    struct TestTask {
        definition: EnqueueTask,
        status: &'static str,
        attempt_count: i64,
        lease_token: Option<LeaseToken>,
        lease_until: Option<Instant>,
    }

    #[derive(Clone, Default)]
    struct MemoryStore {
        tasks: Arc<Mutex<BTreeMap<String, TestTask>>>,
    }

    impl MemoryStore {
        fn expire(&self, task_id: &TaskId) {
            self.tasks
                .lock()
                .expect("store lock")
                .get_mut(task_id.as_str())
                .expect("task")
                .lease_until = Some(Instant::now() - Duration::from_secs(1));
        }

        fn reaches(tasks: &BTreeMap<String, TestTask>, start: &str, target: &str) -> bool {
            let mut pending = vec![start.to_owned()];
            let mut visited = BTreeSet::new();
            while let Some(id) = pending.pop() {
                if !visited.insert(id.clone()) {
                    continue;
                }
                let Some(task) = tasks.get(&id) else {
                    continue;
                };
                for dependency in &task.definition.dependencies {
                    if dependency.as_str() == target {
                        return true;
                    }
                    pending.push(dependency.as_str().to_owned());
                }
            }
            false
        }
    }

    #[async_trait]
    impl TaskStore for MemoryStore {
        async fn migrate(&self) -> anyhow::Result<()> {
            Ok(())
        }

        async fn register_agent(&self, _agent_id: &AgentId, _pod_name: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn enqueue(&self, task: &EnqueueTask) -> anyhow::Result<()> {
            task.validate()?;
            let tasks = self.tasks.lock().expect("store lock");
            let ready = task.dependencies.iter().all(|dependency| {
                tasks
                    .get(dependency.as_str())
                    .is_some_and(|dependency| dependency.status == "COMPLETED")
            });
            drop(tasks);
            self.tasks.lock().expect("store lock").insert(
                task.id.as_str().to_owned(),
                TestTask {
                    definition: task.clone(),
                    status: if ready { "READY" } else { "BLOCKED" },
                    attempt_count: 0,
                    lease_token: None,
                    lease_until: None,
                },
            );
            Ok(())
        }

        async fn active_delivery(
            &self,
            source_commit: &str,
            kind: &str,
        ) -> anyhow::Result<Option<TaskId>> {
            Ok(self
                .tasks
                .lock()
                .expect("store lock")
                .values()
                .find(|task| {
                    task.definition.source_commit == source_commit
                        && task.definition.kind == kind
                        && matches!(task.status, "READY" | "RUNNING" | "CANCELLING" | "BLOCKED")
                })
                .map(|task| task.definition.id.clone()))
        }

        async fn cancel(&self, task_id: &TaskId, _reason: &str) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let Some(root) = tasks.get(task_id.as_str()) else {
                return Ok(false);
            };
            if !matches!(root.status, "READY" | "RUNNING" | "BLOCKED" | "FAILED") {
                return Ok(false);
            }
            let mut pending = vec![task_id.as_str().to_owned()];
            let mut graph_members = BTreeSet::new();
            while let Some(id) = pending.pop() {
                if !graph_members.insert(id.clone()) {
                    continue;
                }
                let Some(task) = tasks.get(&id) else {
                    continue;
                };
                pending.extend(
                    task.definition
                        .dependencies
                        .iter()
                        .map(|dependency| dependency.as_str().to_owned()),
                );
            }
            let members = graph_members
                .iter()
                .filter(|id| {
                    if id.as_str() == task_id.as_str() {
                        return true;
                    }
                    let task = tasks.get(id.as_str()).expect("dependency task");
                    matches!(task.status, "READY" | "RUNNING" | "BLOCKED")
                        && !tasks.iter().any(|(outside_id, outside)| {
                            !graph_members.contains(outside_id)
                                && matches!(outside.status, "READY" | "RUNNING" | "BLOCKED")
                                && Self::reaches(&tasks, outside_id, id)
                        })
                })
                .cloned()
                .collect::<Vec<_>>();
            for id in members {
                let task = tasks.get_mut(&id).expect("cancelled task");
                if task.status == "RUNNING" {
                    task.status = "CANCELLING";
                } else {
                    task.status = "CANCELLED";
                    task.lease_token = None;
                    task.lease_until = None;
                }
            }
            Ok(true)
        }

        async fn acknowledge_cancellation(
            &self,
            task: &ClaimedTask,
            _agent_id: &AgentId,
        ) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let Some(stored) = tasks.get_mut(task.id.as_str()) else {
                return Ok(false);
            };
            if stored.status != "CANCELLING"
                || stored.lease_token.as_ref() != Some(&task.lease_token)
            {
                return Ok(false);
            }
            stored.status = "CANCELLED";
            stored.lease_token = None;
            stored.lease_until = None;
            Ok(true)
        }

        async fn cancellation_targets(
            &self,
            _task_id: &TaskId,
        ) -> anyhow::Result<Vec<CancellationTarget>> {
            Ok(Vec::new())
        }

        async fn finalize_cancellation(&self, task_id: &TaskId) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let Some(task) = tasks.get_mut(task_id.as_str()) else {
                return Ok(false);
            };
            if task.status != "CANCELLING" {
                return Ok(false);
            }
            task.status = "CANCELLED";
            task.lease_token = None;
            task.lease_until = None;
            Ok(true)
        }

        async fn claim(
            &self,
            _agent_id: &AgentId,
            lease_seconds: i64,
        ) -> anyhow::Result<ClaimOutcome> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let completed = tasks
                .iter()
                .filter(|(_, task)| task.status == "COMPLETED")
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            let Some(task) = tasks.values_mut().find(|task| {
                let lease_expired = task
                    .lease_until
                    .is_some_and(|lease| lease <= Instant::now());
                (task.status == "READY" || (task.status == "RUNNING" && lease_expired))
                    && task.attempt_count < task.definition.max_attempts
                    && task
                        .definition
                        .dependencies
                        .iter()
                        .all(|dependency| completed.contains(&dependency.as_str().to_owned()))
            }) else {
                return Ok(ClaimOutcome::NoTask);
            };
            task.status = "RUNNING";
            task.attempt_count += 1;
            let lease_token = LeaseToken::new(Uuid::new_v4().to_string())?;
            task.lease_token = Some(lease_token.clone());
            task.lease_until =
                Some(Instant::now() + Duration::from_secs(u64::try_from(lease_seconds)?));
            Ok(ClaimOutcome::Claimed(ClaimedTask {
                id: task.definition.id.clone(),
                kind: task.definition.kind.clone(),
                prompt: task.definition.prompt.clone(),
                source_commit: task.definition.source_commit.clone(),
                attempt_id: AttemptId::new(Uuid::new_v4().to_string())?,
                attempt_number: task.attempt_count,
                lease_token,
                dependency_context: Vec::new(),
                dependency_artifacts: Vec::new(),
            }))
        }

        async fn heartbeat(
            &self,
            task_id: &TaskId,
            _agent_id: &AgentId,
            lease_token: &LeaseToken,
            lease_seconds: i64,
        ) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let task = tasks.get_mut(task_id.as_str()).expect("task");
            let accepted = task.status == "RUNNING"
                && task.lease_token.as_ref() == Some(lease_token)
                && task.lease_until.is_some_and(|lease| lease > Instant::now());
            if accepted {
                task.lease_until =
                    Some(Instant::now() + Duration::from_secs(u64::try_from(lease_seconds)?));
            }
            Ok(accepted)
        }

        async fn record_activity(
            &self,
            task: &ClaimedTask,
            _agent_id: &AgentId,
            _activity: &TaskActivity,
        ) -> anyhow::Result<bool> {
            Ok(self
                .tasks
                .lock()
                .expect("store lock")
                .get(task.id.as_str())
                .is_some_and(|stored| {
                    stored.status == "RUNNING"
                        && stored.lease_token.as_ref() == Some(&task.lease_token)
                }))
        }

        async fn complete(
            &self,
            claimed: &ClaimedTask,
            _agent_id: &AgentId,
            _summary: &str,
            _artifact: &CompletionArtifact,
        ) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let task = tasks.get_mut(claimed.id.as_str()).expect("task");
            let accepted = task.lease_token.as_ref() == Some(&claimed.lease_token)
                && task.lease_until.is_some_and(|lease| lease > Instant::now());
            if accepted {
                task.status = "COMPLETED";
                task.lease_token = None;
                task.lease_until = None;
            }
            let completed = tasks
                .iter()
                .filter(|(_, candidate)| candidate.status == "COMPLETED")
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for candidate in tasks
                .values_mut()
                .filter(|candidate| candidate.status == "BLOCKED")
            {
                if candidate
                    .definition
                    .dependencies
                    .iter()
                    .all(|dependency| completed.iter().any(|id| id == dependency.as_str()))
                {
                    candidate.status = "READY";
                }
            }
            Ok(accepted)
        }

        async fn release(
            &self,
            claimed: &ClaimedTask,
            _agent_id: &AgentId,
        ) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let task = tasks.get_mut(claimed.id.as_str()).expect("task");
            if task.lease_token.as_ref() != Some(&claimed.lease_token) {
                return Ok(false);
            }
            task.status = "READY";
            task.attempt_count -= 1;
            task.lease_token = None;
            task.lease_until = None;
            Ok(true)
        }

        async fn fail(
            &self,
            claimed: &ClaimedTask,
            _agent_id: &AgentId,
            _error: &str,
        ) -> anyhow::Result<bool> {
            let mut tasks = self.tasks.lock().expect("store lock");
            let task = tasks.get_mut(claimed.id.as_str()).expect("task");
            if task.lease_token.as_ref() != Some(&claimed.lease_token) {
                return Ok(false);
            }
            task.status = if task.attempt_count < task.definition.max_attempts {
                "READY"
            } else {
                "FAILED"
            };
            task.lease_token = None;
            task.lease_until = None;
            Ok(true)
        }

        async fn block(
            &self,
            claimed: &ClaimedTask,
            _agent_id: &AgentId,
            blocker: &EnqueueTask,
            _reason: &str,
        ) -> anyhow::Result<bool> {
            blocker.validate()?;
            let mut tasks = self.tasks.lock().expect("store lock");
            let task = tasks.get_mut(claimed.id.as_str()).expect("task");
            if task.lease_token.as_ref() != Some(&claimed.lease_token) {
                return Ok(false);
            }
            task.status = "BLOCKED";
            task.attempt_count -= 1;
            task.lease_token = None;
            task.lease_until = None;
            task.definition.dependencies.push(blocker.id.clone());
            tasks.insert(
                blocker.id.as_str().to_owned(),
                TestTask {
                    definition: blocker.clone(),
                    status: "READY",
                    attempt_count: 0,
                    lease_token: None,
                    lease_until: None,
                },
            );
            Ok(true)
        }
    }

    fn task(id: &str, dependencies: Vec<TaskId>) -> EnqueueTask {
        EnqueueTask {
            id: TaskId::new(id).expect("valid id"),
            kind: "code".to_owned(),
            trigger: TaskTrigger::ManualCli,
            prompt: "Implement it".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            priority: 0,
            max_attempts: 3,
            dependencies,
        }
    }

    #[tokio::test]
    async fn concurrent_workers_cannot_claim_the_same_attempt() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        store.enqueue(&task("task-1", Vec::new())).await?;
        let agent_a = AgentId::new("agent-a")?;
        let agent_b = AgentId::new("agent-b")?;
        let (claim_a, claim_b) =
            tokio::join!(store.claim(&agent_a, 300), store.claim(&agent_b, 300));

        let claims = match (claim_a?, claim_b?) {
            (ClaimOutcome::Claimed(claim), ClaimOutcome::NoTask)
            | (ClaimOutcome::NoTask, ClaimOutcome::Claimed(claim)) => vec![claim],
            _ => Vec::new(),
        };
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].attempt_number, 1);
        Ok(())
    }

    #[tokio::test]
    async fn incomplete_dependencies_block_claiming() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let dependency = task("dependency", Vec::new());
        store.enqueue(&dependency).await?;
        store
            .enqueue(&task("dependent", vec![dependency.id.clone()]))
            .await?;
        let agent = AgentId::new("agent")?;

        let first = store.claim(&agent, 300).await?.into_claimed()?;
        assert_eq!(first.id, dependency.id);
        assert!(store.claim(&agent, 300).await?.is_idle());
        Ok(())
    }

    #[tokio::test]
    async fn rollout_release_does_not_consume_an_attempt() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        store.enqueue(&task("task-1", Vec::new())).await?;
        let agent = AgentId::new("agent")?;

        let first = store.claim(&agent, 300).await?.into_claimed()?;
        assert!(store.release(&first, &agent).await?);
        let replacement = store.claim(&agent, 300).await?.into_claimed()?;

        assert_eq!(replacement.attempt_number, 1);
        Ok(())
    }

    #[tokio::test]
    async fn discovered_blocker_is_prioritized_and_resumes_original_task() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        store.enqueue(&task("original", Vec::new())).await?;
        let agent = AgentId::new("agent")?;
        let original = store.claim(&agent, 300).await?.into_claimed()?;
        let mut blocker = task("blocker", Vec::new());
        blocker.priority = 100;

        assert!(
            store
                .block(&original, &agent, &blocker, "blocked by prerequisite")
                .await?
        );
        let blocker_claim = store.claim(&agent, 300).await?.into_claimed()?;
        assert_eq!(blocker_claim.id, blocker.id);
        assert!(
            store
                .complete(
                    &blocker_claim,
                    &agent,
                    "blocker fixed",
                    &CompletionArtifact::NotProduced
                )
                .await?
        );
        let resumed = store.claim(&agent, 300).await?.into_claimed()?;
        assert_eq!(resumed.id, original.id);
        assert_eq!(resumed.attempt_number, 1);
        Ok(())
    }

    #[tokio::test]
    async fn expired_lease_rejects_stale_worker_and_allows_retry() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let definition = task("task-1", Vec::new());
        store.enqueue(&definition).await?;
        let agent_a = AgentId::new("agent-a")?;
        let agent_b = AgentId::new("agent-b")?;
        let stale = store.claim(&agent_a, 300).await?.into_claimed()?;
        store.expire(&definition.id);
        let current = store.claim(&agent_b, 300).await?.into_claimed()?;

        assert_ne!(stale.lease_token, current.lease_token);
        assert_eq!(current.attempt_number, 2);
        assert!(
            !store
                .heartbeat(&stale.id, &agent_a, &stale.lease_token, 300)
                .await?
        );
        assert!(
            !store
                .complete(&stale, &agent_a, "late", &CompletionArtifact::NotProduced)
                .await?
        );
        assert!(
            store
                .complete(&current, &agent_b, "done", &CompletionArtifact::NotProduced)
                .await?
        );
        Ok(())
    }

    #[tokio::test]
    async fn cancellation_requires_worker_acknowledgement() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let definition = task("main-failure-sha", Vec::new());
        store.enqueue(&definition).await?;
        let agent = AgentId::new("agent")?;
        let stale = store.claim(&agent, 300).await?.into_claimed()?;

        assert!(
            store
                .cancel(&definition.id, "deferred E2E-only rerun")
                .await?
        );
        assert!(
            !store
                .heartbeat(&stale.id, &agent, &stale.lease_token, 300)
                .await?
        );
        assert_eq!(
            store
                .active_delivery("0123456789abcdef0123456789abcdef01234567", "code")
                .await?,
            Some(definition.id.clone())
        );
        assert!(store.acknowledge_cancellation(&stale, &agent).await?);
        assert_eq!(
            store
                .active_delivery("0123456789abcdef0123456789abcdef01234567", "code")
                .await?,
            None
        );
        assert!(store.claim(&agent, 300).await?.is_idle());
        Ok(())
    }

    #[tokio::test]
    async fn cancellation_policy_retires_an_already_failed_root() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let definition = task("main-failure-failed-sha", Vec::new());
        store.enqueue(&definition).await?;
        let agent = AgentId::new("agent")?;
        let claimed = store.claim(&agent, 300).await?.into_claimed()?;
        assert!(store.fail(&claimed, &agent, "terminal failure").await?);

        assert!(
            store
                .cancel(&definition.id, "deferred E2E-only rerun")
                .await?
        );
        assert!(store.claim(&agent, 300).await?.is_idle());
        Ok(())
    }

    #[tokio::test]
    async fn cancellation_retires_discovered_blockers_with_the_root() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let root = task("main-failure-sha", Vec::new());
        store.enqueue(&root).await?;
        let agent = AgentId::new("agent")?;
        let claimed_root = store.claim(&agent, 300).await?.into_claimed()?;
        let blocker = task("main-failure-sha-blocker", Vec::new());
        assert!(
            store
                .block(&claimed_root, &agent, &blocker, "blocked by prerequisite")
                .await?
        );

        assert!(store.cancel(&root.id, "deferred E2E-only rerun").await?);
        assert!(store.claim(&agent, 300).await?.is_idle());
        Ok(())
    }

    #[tokio::test]
    async fn cancellation_preserves_a_blocker_shared_with_another_root() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let root = task("main-failure-sha", Vec::new());
        store.enqueue(&root).await?;
        let agent = AgentId::new("agent")?;
        let claimed_root = store.claim(&agent, 300).await?.into_claimed()?;
        let blocker = task("shared-blocker", Vec::new());
        assert!(
            store
                .block(&claimed_root, &agent, &blocker, "blocked by prerequisite")
                .await?
        );
        store
            .enqueue(&task("other-root", vec![blocker.id.clone()]))
            .await?;

        assert!(store.cancel(&root.id, "deferred E2E-only rerun").await?);
        let preserved = store.claim(&agent, 300).await?.into_claimed()?;
        assert_eq!(preserved.id, blocker.id);
        Ok(())
    }

    #[tokio::test]
    async fn a_later_delivery_generation_does_not_reuse_a_completed_root() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let old = task("main-failure-sha-run-1-attempt-1", Vec::new());
        store.enqueue(&old).await?;
        let agent = AgentId::new("agent")?;
        let completed = store.claim(&agent, 300).await?.into_claimed()?;
        assert!(
            store
                .complete(
                    &completed,
                    &agent,
                    "fixed",
                    &CompletionArtifact::NotProduced
                )
                .await?
        );
        assert!(!store.cancel(&old.id, "deferred E2E-only rerun").await?);

        let current = task("main-failure-sha-run-1-attempt-3", Vec::new());
        store.enqueue(&current).await?;
        let claimed = store.claim(&agent, 300).await?.into_claimed()?;
        assert_eq!(claimed.id, current.id);
        assert_eq!(claimed.attempt_number, 1);
        Ok(())
    }

    #[tokio::test]
    async fn an_active_delivery_suppresses_a_competing_generation() -> anyhow::Result<()> {
        let store = MemoryStore::default();
        let active = task("main-failure-sha-run-1-attempt-1", Vec::new());
        store.enqueue(&active).await?;

        assert_eq!(
            store
                .active_delivery(&active.source_commit, &active.kind)
                .await?,
            Some(active.id)
        );
        Ok(())
    }
}
