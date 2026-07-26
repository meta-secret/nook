use async_trait::async_trait;

use crate::model::{AgentId, Artifact, ClaimedTask, EnqueueTask, LeaseToken, TaskId};

#[async_trait]
pub trait TaskStore: Clone + Send + Sync + 'static {
    async fn migrate(&self) -> anyhow::Result<()>;

    async fn register_agent(&self, agent_id: &AgentId, pod_name: &str) -> anyhow::Result<()>;

    async fn enqueue(&self, task: &EnqueueTask) -> anyhow::Result<()>;

    async fn claim(
        &self,
        agent_id: &AgentId,
        lease_seconds: i64,
    ) -> anyhow::Result<Option<ClaimedTask>>;

    async fn heartbeat(
        &self,
        task_id: &TaskId,
        agent_id: &AgentId,
        lease_token: &LeaseToken,
        lease_seconds: i64,
    ) -> anyhow::Result<bool>;

    async fn complete(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        summary: &str,
        artifact: Option<&Artifact>,
    ) -> anyhow::Result<bool>;

    async fn fail(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        error: &str,
    ) -> anyhow::Result<bool>;
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use async_trait::async_trait;
    use uuid::Uuid;

    use super::TaskStore;
    use crate::model::{
        AgentId, Artifact, AttemptId, ClaimedTask, EnqueueTask, LeaseToken, TaskId,
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
            task.validate().map_err(anyhow::Error::msg)?;
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

        async fn claim(
            &self,
            _agent_id: &AgentId,
            lease_seconds: i64,
        ) -> anyhow::Result<Option<ClaimedTask>> {
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
                return Ok(None);
            };
            task.status = "RUNNING";
            task.attempt_count += 1;
            let lease_token =
                LeaseToken::new(Uuid::new_v4().to_string()).map_err(anyhow::Error::msg)?;
            task.lease_token = Some(lease_token.clone());
            task.lease_until =
                Some(Instant::now() + Duration::from_secs(u64::try_from(lease_seconds)?));
            Ok(Some(ClaimedTask {
                id: task.definition.id.clone(),
                kind: task.definition.kind.clone(),
                prompt: task.definition.prompt.clone(),
                attempt_id: AttemptId::new(Uuid::new_v4().to_string())
                    .map_err(anyhow::Error::msg)?,
                attempt_number: task.attempt_count,
                lease_token,
                dependency_context: Vec::new(),
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
            let accepted = task.lease_token.as_ref() == Some(lease_token)
                && task.lease_until.is_some_and(|lease| lease > Instant::now());
            if accepted {
                task.lease_until =
                    Some(Instant::now() + Duration::from_secs(u64::try_from(lease_seconds)?));
            }
            Ok(accepted)
        }

        async fn complete(
            &self,
            claimed: &ClaimedTask,
            _agent_id: &AgentId,
            _summary: &str,
            _artifact: Option<&Artifact>,
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
            Ok(accepted)
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
    }

    fn task(id: &str, dependencies: Vec<TaskId>) -> EnqueueTask {
        EnqueueTask {
            id: TaskId::new(id).expect("valid id"),
            kind: "code".to_owned(),
            prompt: "Implement it".to_owned(),
            priority: 0,
            max_attempts: 3,
            dependencies,
        }
    }

    #[tokio::test]
    async fn concurrent_workers_cannot_claim_the_same_attempt() {
        let store = MemoryStore::default();
        store.enqueue(&task("task-1", Vec::new())).await.unwrap();
        let agent_a = AgentId::new("agent-a").unwrap();
        let agent_b = AgentId::new("agent-b").unwrap();
        let (claim_a, claim_b) =
            tokio::join!(store.claim(&agent_a, 300), store.claim(&agent_b, 300));

        let claims = [claim_a.unwrap(), claim_b.unwrap()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].attempt_number, 1);
    }

    #[tokio::test]
    async fn incomplete_dependencies_block_claiming() {
        let store = MemoryStore::default();
        let dependency = task("dependency", Vec::new());
        store.enqueue(&dependency).await.unwrap();
        store
            .enqueue(&task("dependent", vec![dependency.id.clone()]))
            .await
            .unwrap();
        let agent = AgentId::new("agent").unwrap();

        let first = store.claim(&agent, 300).await.unwrap().unwrap();
        assert_eq!(first.id, dependency.id);
        assert!(store.claim(&agent, 300).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn expired_lease_rejects_stale_worker_and_allows_retry() {
        let store = MemoryStore::default();
        let definition = task("task-1", Vec::new());
        store.enqueue(&definition).await.unwrap();
        let agent_a = AgentId::new("agent-a").unwrap();
        let agent_b = AgentId::new("agent-b").unwrap();
        let stale = store.claim(&agent_a, 300).await.unwrap().unwrap();
        store.expire(&definition.id);
        let current = store.claim(&agent_b, 300).await.unwrap().unwrap();

        assert_ne!(stale.lease_token, current.lease_token);
        assert_eq!(current.attempt_number, 2);
        assert!(
            !store
                .heartbeat(&stale.id, &agent_a, &stale.lease_token, 300)
                .await
                .unwrap()
        );
        assert!(
            !store
                .complete(&stale, &agent_a, "late", None)
                .await
                .unwrap()
        );
        assert!(
            store
                .complete(&current, &agent_b, "done", None)
                .await
                .unwrap()
        );
    }
}
