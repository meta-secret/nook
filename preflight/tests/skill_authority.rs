use std::{path::PathBuf, process::Command};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

#[test]
fn tracked_harness_skill_mirrors_remain_absent() -> anyhow::Result<()> {
    let root = repository_root();
    let output = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--",
            ".agents/skills",
            ".cursor/skills",
            ".claude/skills",
        ])
        .current_dir(root)
        .output()?;
    anyhow::ensure!(output.status.success(), "git ls-files failed");
    let tracked = String::from_utf8(output.stdout)?;
    anyhow::ensure!(
        tracked.trim().is_empty(),
        "tracked harness skill mirrors are prohibited:\n{tracked}"
    );
    Ok(())
}
