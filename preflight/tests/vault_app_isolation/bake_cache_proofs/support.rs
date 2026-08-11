use anyhow::Context;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn assert_scope_arms(
    bake: &str,
    name: &str,
    required_all: &[&str],
    required_any: &[&[&str]],
    forbidden: &[&str],
) -> anyhow::Result<()> {
    let body = assignment_body(bake, name)?;
    let (fallback, non_fallback) = split_fallback_arms(body)
        .with_context(|| format!("{name} must define FALLBACK and non-FALLBACK registry arms"))?;
    for (label, arm) in [("FALLBACK", fallback), ("non-FALLBACK", non_fallback)] {
        for token in required_all {
            assert!(
                arm.contains(token),
                "{name} {label} arm must restore {token}"
            );
        }
        for group in required_any {
            assert!(
                group.iter().any(|token| arm.contains(token)),
                "{name} {label} arm must restore one of {group:?}"
            );
        }
        for token in forbidden {
            assert!(
                !arm.contains(token),
                "{name} {label} arm must not import short/forbidden parent {token}"
            );
        }
    }
    Ok(())
}

fn assignment_body<'a>(bake: &'a str, name: &str) -> anyhow::Result<&'a str> {
    let marker = format!("{name} =");
    let rest = bake
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .with_context(|| format!("missing Bake assignment {name}"))?;
    let mut end = rest.len();
    for (idx, _) in rest.match_indices('\n') {
        let line = rest[idx + 1..].lines().next().unwrap_or("");
        if line.starts_with("target \"") {
            end = idx;
            break;
        }
        if let Some((ident, _)) = line.split_once(" =")
            && !ident.is_empty()
            && ident.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            end = idx;
            break;
        }
    }
    Ok(rest[..end].trim())
}

fn split_fallback_arms(body: &str) -> anyhow::Result<(&str, &str)> {
    const FALLBACK_MARK: &str = "GHA_CACHE_FALLBACK_ENABLED != \"\" ? [";
    const ARM_SPLIT: &str = "] : [";
    let after = body
        .split_once(FALLBACK_MARK)
        .map(|(_, rest)| rest)
        .context("missing GHA_CACHE_FALLBACK_ENABLED ternary")?;
    let (fallback, rest) = after
        .split_once(ARM_SPLIT)
        .context("missing FALLBACK / non-FALLBACK arm split")?;
    let non_fallback = rest
        .rsplit_once(']')
        .map(|(arm, _)| arm)
        .context("non-FALLBACK arm must close with ]")?;
    Ok((fallback.trim(), non_fallback.trim()))
}

pub(super) fn split_exact_available_arm<'a>(
    body: &'a str,
    availability: &str,
) -> anyhow::Result<&'a str> {
    let marker = format!("{availability} != \"\" ? [");
    let after = body
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .with_context(|| format!("missing exact-availability ternary for {availability}"))?;
    let exact = after
        .split_once("] : GHA_CACHE_FALLBACK_ENABLED")
        .map(|(arm, _)| arm)
        .with_context(|| format!("exact arm for {availability} must precede cold fallback"))?;
    Ok(exact.trim())
}

pub(super) fn assert_no_empty_bake_cache_overrides(path: &str, text: &str) {
    for key in ["cache-from=", "cache-to="] {
        for (index, line) in text.lines().enumerate() {
            let Some(after) = line.split(key).nth(1) else {
                continue;
            };
            let rest = after.trim_start();
            let empty = rest.is_empty()
                || rest.starts_with('\\')
                || matches!(rest.chars().next(), Some('"' | '\''));
            assert!(
                !empty,
                "{path}:{} clears Bake {key}; empty cache overrides are prohibited — use scoped *-publish targets",
                index + 1
            );
        }
    }
}

pub(super) fn collect_cache_caller_paths(dir: &Path, out: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    let mut queue = VecDeque::from([dir.to_path_buf()]);
    while let Some(current) = queue.pop_front() {
        for entry in fs::read_dir(&current)
            .with_context(|| format!("failed to read {}", current.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if matches!(
                    name.as_ref(),
                    "node_modules"
                        | "target"
                        | "dist"
                        | ".git"
                        | "coverage"
                        | "playwright-report"
                        | "test-results"
                ) {
                    continue;
                }
                queue.push_back(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let keep = name == "Taskfile.yml"
                || name.ends_with(".yml")
                || name.ends_with(".yaml")
                || name.ends_with(".sh");
            if keep {
                out.push(path);
            }
        }
    }
    Ok(())
}
