use std::future::Future;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::HiveContext;

const PROGRESS_INTERVAL: Duration = Duration::from_secs(30);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(540);

pub async fn prepare_dispatcher_health(health_path: &Path) -> crate::HiveResult<()> {
    let progress_path = progress_path(health_path);
    for path in [
        health_path.to_path_buf(),
        next_path(health_path),
        progress_path.clone(),
        next_path(&progress_path),
    ] {
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error).with_hive_context(|| {
                    format!(
                        "invalidate Workbench dispatcher health heartbeat at {}",
                        path.display()
                    )
                });
            }
        }
    }
    record_health(&progress_path).await
}

pub(super) async fn record_dispatcher_health(health_path: &Path) -> crate::HiveResult<()> {
    record_health(health_path).await
}

pub(super) async fn while_recording_dispatcher_progress<F, T>(
    health_path: &Path,
    future: F,
) -> crate::HiveResult<T>
where
    F: Future<Output = crate::HiveResult<T>>,
{
    let progress_path = progress_path(health_path);
    record_health(&progress_path).await?;
    tokio::pin!(future);
    let timeout = tokio::time::sleep(OPERATION_TIMEOUT);
    tokio::pin!(timeout);
    let mut interval = tokio::time::interval(PROGRESS_INTERVAL);
    interval.tick().await;
    loop {
        tokio::select! {
            result = &mut future => return result,
            _ = interval.tick() => record_health(&progress_path).await?,
            () = &mut timeout => return Err(crate::HiveError::message(
                "Workbench dispatcher operation exceeded 540 seconds",
            )),
        }
    }
}

pub(super) async fn sleep_while_recording_dispatcher_progress(
    health_path: &Path,
    duration: Duration,
) -> crate::HiveResult<()> {
    let progress_path = progress_path(health_path);
    let sleep = tokio::time::sleep(duration);
    tokio::pin!(sleep);
    let mut interval = tokio::time::interval(PROGRESS_INTERVAL);
    interval.tick().await;
    loop {
        tokio::select! {
            () = &mut sleep => return Ok(()),
            _ = interval.tick() => record_health(&progress_path).await?,
        }
    }
}

async fn record_health(health_path: &Path) -> crate::HiveResult<()> {
    let timestamp = unix_timestamp_seconds(SystemTime::now())?;
    let next_health_path = next_path(health_path);
    tokio::fs::write(&next_health_path, format!("{timestamp}\n"))
        .await
        .with_hive_context(|| {
            format!(
                "write Workbench dispatcher health heartbeat at {}",
                next_health_path.display()
            )
        })?;
    tokio::fs::rename(&next_health_path, health_path)
        .await
        .with_hive_context(|| {
            format!(
                "publish Workbench dispatcher health heartbeat at {}",
                health_path.display()
            )
        })
}

fn progress_path(health_path: &Path) -> std::path::PathBuf {
    path_with_suffix(health_path, ".progress")
}

fn next_path(health_path: &Path) -> std::path::PathBuf {
    path_with_suffix(health_path, ".next")
}

fn path_with_suffix(path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut path = path.as_os_str().to_owned();
    path.push(suffix);
    path.into()
}

pub fn check_workbench_dispatcher_health(
    health_path: &Path,
    max_age: Duration,
) -> crate::HiveResult<()> {
    check_workbench_dispatcher_health_at(
        health_path,
        max_age,
        SystemTime::now(),
        Path::new("/proc"),
    )
}

pub fn check_workbench_dispatcher_progress(
    health_path: &Path,
    max_age: Duration,
) -> crate::HiveResult<()> {
    check_workbench_dispatcher_health(&progress_path(health_path), max_age)
}

fn check_workbench_dispatcher_health_at(
    health_path: &Path,
    max_age: Duration,
    now: SystemTime,
    process_root: &Path,
) -> crate::HiveResult<()> {
    let heartbeat = std::fs::read_to_string(health_path).with_hive_context(|| {
        format!(
            "read Workbench dispatcher health heartbeat at {}",
            health_path.display()
        )
    })?;
    let heartbeat = heartbeat
        .trim()
        .parse::<u64>()
        .hive_context("parse Workbench dispatcher health heartbeat")?;
    let now = unix_timestamp_seconds(now)?;
    let age = now.checked_sub(heartbeat).hive_context(
        "Workbench dispatcher health heartbeat is later than the current system time",
    )?;
    if age > max_age.as_secs() {
        return Err(crate::error::HiveError::message(format!(
            "Workbench dispatcher health heartbeat is {age} seconds old"
        )));
    }

    let zombies = zombie_process_count(process_root)?;
    if zombies != 0 {
        return Err(crate::error::HiveError::message(format!(
            "Workbench dispatcher has {zombies} unreaped child processes"
        )));
    }
    Ok(())
}

fn unix_timestamp_seconds(time: SystemTime) -> crate::HiveResult<u64> {
    Ok(time
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            crate::error::HiveError::message(format!(
                "system time is earlier than the Unix epoch: {error}"
            ))
        })?
        .as_secs())
}

fn zombie_process_count(process_root: &Path) -> crate::HiveResult<usize> {
    let mut zombies = 0;
    for entry in std::fs::read_dir(process_root)
        .with_hive_context(|| format!("read process information at {}", process_root.display()))?
    {
        let entry = entry?;
        let name = entry.file_name();
        if !name
            .to_string_lossy()
            .bytes()
            .all(|byte| byte.is_ascii_digit())
        {
            continue;
        }
        let stat_path = entry.path().join("stat");
        let stat = match std::fs::read_to_string(&stat_path) {
            Ok(stat) => stat,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(error).with_hive_context(|| {
                    format!("read process state at {}", stat_path.display())
                });
            }
        };
        let process_state = stat
            .rfind(") ")
            .and_then(|position| stat.as_bytes().get(position + 2));
        if process_state == Some(&b'Z') {
            zombies += 1;
        }
    }
    Ok(zombies)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn dispatcher_health_rejects_stale_heartbeats_and_unreaped_children() -> crate::HiveResult<()> {
        let root = tempfile::tempdir()?;
        let health = root.path().join("health");
        let processes = root.path().join("proc");
        std::fs::create_dir(&processes)?;
        std::fs::write(&health, "100\n")?;
        std::fs::create_dir(processes.join("1"))?;
        std::fs::write(processes.join("1/stat"), "1 (hive) S 0 0 0\n")?;

        super::check_workbench_dispatcher_health_at(
            &health,
            Duration::from_secs(10),
            UNIX_EPOCH + Duration::from_secs(105),
            &processes,
        )?;

        let stale = super::check_workbench_dispatcher_health_at(
            &health,
            Duration::from_secs(4),
            UNIX_EPOCH + Duration::from_secs(105),
            &processes,
        );
        assert!(stale.is_err());

        std::fs::create_dir(processes.join("2"))?;
        std::fs::write(processes.join("2/stat"), "2 (git) Z 1 0 0\n")?;
        let zombie = super::check_workbench_dispatcher_health_at(
            &health,
            Duration::from_secs(10),
            UNIX_EPOCH + Duration::from_secs(105),
            &processes,
        );
        assert!(zombie.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn dispatcher_restart_invalidates_inherited_heartbeat() -> crate::HiveResult<()> {
        let root = tempfile::tempdir()?;
        let health = root.path().join("health");
        let next = health.with_extension("next");
        std::fs::write(&health, "100\n")?;
        std::fs::write(&next, "101\n")?;

        super::prepare_dispatcher_health(&health).await?;

        assert!(!health.exists());
        assert!(!next.exists());
        assert!(super::progress_path(&health).exists());
        Ok(())
    }
}
