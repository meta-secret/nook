use super::*;
use tokio::time as async_time;

pub(super) async fn run<S: TaskStore>(
    store: S,
    agent_id: AgentId,
    task: ClaimedTask,
    lease_seconds: i64,
    heartbeat_seconds: u64,
    mut stop: watch::Receiver<bool>,
) -> crate::HiveResult<()> {
    let mut interval = async_time::interval(Duration::from_secs(heartbeat_seconds));
    let mut renewal = 0_u64;
    interval.tick().await;
    loop {
        tokio::select! {
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return Ok(());
                }
            }
            _ = interval.tick() => {
                let accepted = store
                    .heartbeat(
                        &task.id,
                        &agent_id,
                        &task.lease_token,
                        lease_seconds,
                    )
                    .await?;
                if !accepted {
                    return Err(WorkerCancellationRequested.into());
                }
                renewal += 1;
                eprintln!(
                    "Hive lease heartbeat accepted task={} renewal={renewal}",
                    task.id
                );
            }
        }
    }
}
