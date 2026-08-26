use std::{collections::BTreeSet, fs, path::PathBuf, process::Command};

use anyhow::Result;

const CLUSTER_ENTRYPOINTS: &[&str] = &[
    ".github/actions/nook-docker-setup/action.yml",
    ".github/actions/nook-node-setup/action.yml",
    ".github/scripts/arc-runtime-smoke.sh",
    ".github/scripts/ci-release-deploy-vaults.sh",
    ".github/scripts/remote-task-batch.sh",
    ".github/scripts/wait-hive-neo4j.sh",
];

const EXPECTED_REMOTE_CATALOG: &[&str] = &[
    "preflight",
    "arc:runtime",
    "rust:ci",
    "web:build",
    "web:e2e",
    "extension:e2e",
    "hive:verify",
    "check",
    "ci:pr",
    "ci:pr:e2e",
];

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn assert_no_nested_runtime(label: &str, source: &str) {
    let normalized = source.to_ascii_lowercase();
    for runtime in ["docker", "podman", "nerdctl"] {
        for namespace in ["", "container ", "compose "] {
            for verb in [
                "run", "create", "start", "exec", "stop", "kill", "rm", "restart",
            ] {
                let command = format!("{runtime} {namespace}{verb}");
                assert!(
                    !normalized.contains(&command),
                    "{label} must not control a nested container runtime: {command}"
                );
            }
        }
    }
    for command in [
        "crictl run",
        "crictl create",
        "crictl start",
        "crictl exec",
        "crictl stop",
        "crictl rm",
        "ctr run",
        "ctr task",
        "docker:dind",
        "dockerd",
        "podman system service",
        "/var/run/docker.sock",
        "/run/docker.sock",
        "podman.sock",
        "containerd.sock",
        "crio.sock",
    ] {
        assert!(
            !normalized.contains(command),
            "{label} must not expose or control a nested runtime: {command}"
        );
    }
}

fn cluster_job_blocks(workflow: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    let mut in_jobs = false;

    for line in workflow.lines() {
        if line == "jobs:" {
            in_jobs = true;
            continue;
        }
        if !in_jobs {
            continue;
        }
        let is_job_heading =
            line.starts_with("  ") && !line.starts_with("    ") && line.trim_end().ends_with(':');
        if is_job_heading && !current.is_empty() {
            blocks.push(std::mem::take(&mut current));
        }
        if is_job_heading || !current.is_empty() {
            current.push_str(line);
            current.push('\n');
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }

    blocks
        .into_iter()
        .filter(|block| {
            block.lines().any(|line| {
                let trimmed = line.trim_start();
                trimmed.starts_with("runs-on:")
                    && (trimmed.contains("nook-k0s") || trimmed.contains("NOOK_RUNS_ON"))
            })
        })
        .collect()
}

fn remote_catalog() -> Result<BTreeSet<String>> {
    let output = Command::new("bash")
        .arg(repository_root().join(".github/scripts/remote-task-batch.sh"))
        .arg("--list")
        .output()?;
    assert!(output.status.success(), "remote catalog must be readable");
    Ok(String::from_utf8(output.stdout)?
        .lines()
        .map(str::to_owned)
        .collect())
}

#[test]
fn k0s_jobs_and_cluster_entrypoints_never_control_nested_runtimes() -> Result<()> {
    let workflow_directory = repository_root().join(".github/workflows");
    for entry in fs::read_dir(workflow_directory)? {
        let path = entry?.path();
        let workflow = fs::read_to_string(&path)?;
        for (index, job) in cluster_job_blocks(&workflow).iter().enumerate() {
            assert_no_nested_runtime(&format!("{} cluster job {index}", path.display()), job);
        }
    }

    for path in CLUSTER_ENTRYPOINTS {
        assert_no_nested_runtime(path, &read(path));
    }

    let expected = EXPECTED_REMOTE_CATALOG
        .iter()
        .copied()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        remote_catalog()?,
        expected,
        "ARC catalog may expose only build-only or direct-Pod implementations"
    );

    let remote_workflow = read(".github/workflows/remote.yml");
    assert!(remote_workflow.contains("runs-on: nook-k0s-container"));
    assert!(remote_workflow.contains("container:"));
    assert!(remote_workflow.contains("task _web:test:e2e"));
    assert!(remote_workflow.contains("task _extension:test:e2e"));

    let release_deploy = read(".github/scripts/ci-release-deploy-vaults.sh");
    assert!(
        release_deploy.contains("node nook-app/nook-web/nook-web-app/node_modules/.bin/wrangler")
    );

    let cortex_rule = read(".cortex/dynamic-skills/kubernetes-native-cluster-execution.md");
    assert!(cortex_rule.contains("P1 hard rule"));
    assert!(cortex_rule.contains("BuildKit shard is a build service only"));
    assert!(cortex_rule.contains("Playwright directly inside an ordinary Pod"));
    assert!(cortex_rule.contains("local-machine container runtime policy"));
    Ok(())
}
