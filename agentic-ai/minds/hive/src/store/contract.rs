use async_trait::async_trait;

use crate::model::{
    ActivityLease, AgentId, CancellationTarget, ClaimOutcome, ClaimedTask, EnqueueTask, LeaseToken,
    TaskActivity, TaskId,
};

#[async_trait]
pub trait TaskStore: Clone + Send + Sync + 'static {
    async fn migrate(&self) -> crate::HiveResult<()>;

    async fn register_agent(&self, agent_id: &AgentId, pod_name: &str) -> crate::HiveResult<()>;

    async fn enqueue(&self, task: &EnqueueTask) -> crate::HiveResult<()>;

    async fn active_delivery(
        &self,
        request: crate::model::ActiveDeliveryQuery<'_>,
    ) -> crate::HiveResult<Option<TaskId>>;

    async fn cancel(&self, task_id: &TaskId, reason: &str) -> crate::HiveResult<bool>;

    async fn cancellation_targets(
        &self,
        task_id: &TaskId,
    ) -> crate::HiveResult<Vec<CancellationTarget>>;

    async fn finalize_cancellation(&self, task_id: &TaskId) -> crate::HiveResult<bool>;

    async fn acknowledge_cancellation(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
    ) -> crate::HiveResult<bool>;

    async fn claim(
        &self,
        agent_id: &AgentId,
        lease_seconds: i64,
    ) -> crate::HiveResult<ClaimOutcome>;

    async fn heartbeat(
        &self,
        task_id: &TaskId,
        agent_id: &AgentId,
        lease_token: &LeaseToken,
        lease_seconds: i64,
    ) -> crate::HiveResult<bool>;

    async fn record_activity(
        &self,
        _lease: &ActivityLease,
        _agent_id: &AgentId,
        _activity: &TaskActivity,
    ) -> crate::HiveResult<bool> {
        Ok(false)
    }

    async fn release(&self, task: &ClaimedTask, agent_id: &AgentId) -> crate::HiveResult<bool>;

    async fn complete(&self, completion: crate::model::Completion<'_>) -> crate::HiveResult<bool>;

    async fn fail(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        error: &str,
    ) -> crate::HiveResult<bool>;

    async fn block(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        blocker: &EnqueueTask,
        reason: &str,
    ) -> crate::HiveResult<bool>;
}
