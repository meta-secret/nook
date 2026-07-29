use std::future::Future;
use std::io::Write as _;
use std::path::Path;

use anyhow::Context;
use tokio::sync::watch;

pub(super) enum ClaimWindow<T> {
    Completed(T),
    CompletedDuringShutdown(T),
    Stopped,
}

pub(super) async fn finish_claim_during_shutdown<F, T>(
    claim: F,
    shutdown: watch::Receiver<bool>,
) -> ClaimWindow<T>
where
    F: Future<Output = T>,
{
    if *shutdown.borrow() {
        return ClaimWindow::Stopped;
    }
    tokio::pin!(claim);
    tokio::select! {
        biased;
        requested = shutdown_requested(shutdown) => {
            if requested.is_err() {
                return ClaimWindow::Stopped;
            }
            ClaimWindow::CompletedDuringShutdown(claim.await)
        }
        result = &mut claim => ClaimWindow::Completed(result),
    }
}

pub(super) async fn shutdown_requested(mut shutdown: watch::Receiver<bool>) -> anyhow::Result<()> {
    shutdown
        .wait_for(|requested| *requested)
        .await
        .map(|_| ())
        .context("worker termination signal relay stopped")
}

pub(super) fn establish_worker_lifecycle(workspace: &Path, pod_name: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(workspace)?;
    let startup_marker = workspace.join(".hive-worker-started");
    let startup_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&startup_marker);
    let mut startup_file = match startup_file {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::write(workspace.join(".hive-task-finished"), pod_name)?;
            return Err(error).context("refusing to restart a Hive worker inside an existing Pod");
        }
        Err(error) => return Err(error).context("failed to establish Hive worker lifecycle"),
    };
    startup_file.write_all(pod_name.as_bytes())?;
    startup_file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ClaimWindow, establish_worker_lifecycle, finish_claim_during_shutdown};

    #[tokio::test]
    async fn shutdown_finishes_an_inflight_claim_before_releasing_control() -> anyhow::Result<()> {
        let (claim_tx, claim_rx) = tokio::sync::oneshot::channel();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let claim = tokio::spawn(finish_claim_during_shutdown(
            async move {
                let _ = started_tx.send(());
                claim_rx.await
            },
            shutdown_rx,
        ));

        started_rx.await?;
        shutdown_tx.send(true)?;
        tokio::task::yield_now().await;
        assert!(
            !claim.is_finished(),
            "shutdown must not cancel a claim that can still commit in Neo4j"
        );
        claim_tx
            .send("claimed")
            .map_err(|_| anyhow::anyhow!("claim receiver stopped before completion"))?;

        assert!(matches!(
            claim.await?,
            ClaimWindow::CompletedDuringShutdown(Ok("claimed"))
        ));
        Ok(())
    }

    #[tokio::test]
    async fn shutdown_before_polling_does_not_start_a_new_claim() -> anyhow::Result<()> {
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        shutdown_tx.send(true)?;

        assert!(matches!(
            finish_claim_during_shutdown(async { panic!("claim was polled") }, shutdown_rx).await,
            ClaimWindow::Stopped
        ));
        Ok(())
    }

    #[test]
    fn a_restarted_process_cannot_reuse_the_same_pod_workspace() -> anyhow::Result<()> {
        let workspace = tempfile::tempdir()?;

        establish_worker_lifecycle(workspace.path(), "pod-a")?;
        let error = establish_worker_lifecycle(workspace.path(), "pod-a")
            .expect_err("the second worker process must be rejected");

        assert!(
            error
                .to_string()
                .contains("refusing to restart a Hive worker")
        );
        assert!(workspace.path().join(".hive-task-finished").is_file());
        Ok(())
    }
}
