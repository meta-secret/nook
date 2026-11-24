#[path = "support/repository_files.rs"]
mod repository_files;

use repository_files::{RepositoryFixture, RepositoryPathRead};
use std::{
    env, fs,
    os::unix::fs::{self as unix_fs, PermissionsExt},
    path::{Path, PathBuf},
    process::{self, Command},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;

fn section<'a>(content: &'a str, start: &str, end: &str) -> &'a str {
    content
        .split_once(start)
        .unwrap_or_else(|| panic!("missing section start: {start}"))
        .1
        .split_once(end)
        .unwrap_or_else(|| panic!("missing section end: {end}"))
        .0
}

fn taskfile_task_body<'a>(tasks: &'a str, name: &str) -> anyhow::Result<&'a str> {
    let marker = format!("  {name}:");
    let rest = tasks
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .ok_or_else(|| anyhow::anyhow!("missing Taskfile task {name}"))?;
    let mut end = rest.len();
    for (idx, _) in rest.match_indices('\n') {
        let line = rest
            .get(idx + 1..)
            .with_context(|| format!("Taskfile task {name} line must be valid UTF-8"))?
            .split('\n')
            .next()
            .with_context(|| format!("Taskfile task {name} must expose its next line"))?;
        if line.starts_with("  ")
            && !line.starts_with("   ")
            && line.trim_end().ends_with(':')
            && !line.trim_start().starts_with('#')
        {
            end = idx;
            break;
        }
    }
    Ok(rest
        .get(..end)
        .with_context(|| format!("Taskfile task {name} boundary must be valid UTF-8"))?
        .trim())
}

#[path = "vault_app_isolation/agent_and_local_workflow_contracts.rs"]
mod agent_and_local_workflow_contracts;
#[path = "vault_app_isolation/build_contracts.rs"]
#[allow(clippy::unnecessary_wraps)]
mod build_contracts;
#[path = "vault_app_isolation/cloudflare_origin_contracts.rs"]
mod cloudflare_origin_contracts;
#[path = "vault_app_isolation/hosted_delivery_contracts.rs"]
mod hosted_delivery_contracts;
#[path = "vault_app_isolation/local_harness_contracts.rs"]
mod local_harness_contracts;
#[path = "vault_app_isolation/playwright_coverage_contracts.rs"]
mod playwright_coverage_contracts;
#[path = "vault_app_isolation/prepared_pod_build_contracts.rs"]
mod prepared_pod_build_contracts;
#[path = "vault_app_isolation/runtime_boundary_contracts.rs"]
mod runtime_boundary_contracts;
#[path = "vault_app_isolation/web_quality_contracts.rs"]
mod web_quality_contracts;
