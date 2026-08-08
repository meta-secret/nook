use std::fs;
use std::path::PathBuf;

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(relative_path: &str) -> String {
    fs::read_to_string(repository_root().join(relative_path))
        .unwrap_or_else(|error| panic!("failed to read {relative_path}: {error}"))
}

#[test]
fn bake_cache_sim_fixtures_mirror_parent_leaf_scopes() {
    let sim = "infra/sim/bake-cache";
    for path in [
        format!("{sim}/zot-config.json"),
        format!("{sim}/docker-bake.hcl"),
        format!("{sim}/parent.Dockerfile"),
        format!("{sim}/leaf.Dockerfile"),
        format!("{sim}/inputs/parent.txt"),
        format!("{sim}/inputs/leaf.txt"),
    ] {
        assert!(
            repository_root().join(&path).is_file(),
            "missing bake-cache sim fixture {path}"
        );
    }

    let bake = read(&format!("{sim}/docker-bake.hcl"));
    let tasks = read("infra/tasks/bake-cache.yml");
    let zot = read(&format!("{sim}/zot-config.json"));
    let quality = read(".cortex/workflows/quality.md");

    assert!(
        zot.contains("\"compat\": [\"docker2s2\"]") && zot.contains("anonymousPolicy"),
        "sim Zot must allow anonymous docker2s2 push/pull"
    );
    assert!(
        bake.contains("target \"parent\"")
            && bake.contains("target \"parent-publish\"")
            && bake.contains("target \"leaf\"")
            && bake.contains("target \"leaf-short-chain\"")
            && bake.contains("target \"parent-pr-cold\""),
        "sim Bake must expose parent/leaf/publish/short-chain/pr-cold targets"
    );
    assert!(
        bake.contains("parent-publish")
            && bake.contains("cache-to = parent_cache_to")
            && !assignment_mentions_cache_to(&bake, "parent"),
        "parent-publish must own cache-to; context parent must not"
    );
    let leaf_from = assignment_body(&bake, "leaf_cache_from");
    let short_from = assignment_body(&bake, "leaf_short_chain_cache_from");
    assert!(
        !leaf_from.contains("nook-bake-sim-parent-v1"),
        "own-scope leaf must not list parent scope in cache-from"
    );
    assert!(
        short_from.contains("nook-bake-sim-parent-v1")
            && !short_from.contains("nook-bake-sim-leaf-v1"),
        "short-chain leaf must cache-from only parent scope (no leaf own-scope)"
    );
    assert!(
        !bake.contains("cache-from=\"\"")
            && !bake.contains("cache-to=\"\"")
            && !tasks.contains("cache-from=")
            && !tasks.contains("cache-to="),
        "sim Bake/Task must not clear cache-from/cache-to"
    );
    assert!(
        tasks.contains("bake-cache:prove:")
            && tasks.contains("buildx create")
            && tasks.contains("network create")
            && tasks.contains("require_cached_step")
            && tasks.contains("bake-sim-parent-expensive")
            && tasks.contains("bake-sim-leaf-expensive")
            && tasks.contains("Scenario D:")
            && tasks.contains("Scenario E:")
            && tasks.contains("Scenario F:")
            && tasks.contains("Scenario H:")
            && tasks.contains("Scenario I:")
            && tasks.contains("Scenario J:")
            && tasks.contains("parent-pr-cold")
            && tasks.contains("require_registry_ref")
            && tasks.contains("require_no_registry_ref")
            && tasks.contains("nook/remote-buildcache/")
            && bake.contains("PARENT_OWN_CACHE_ENABLED")
            && bake.contains("write_cache_repository"),
        "infra bake-cache prove must cover FALLBACK plus Main/PR isolation"
    );
    assert!(
        quality.contains("task infra:bake-cache:prove")
            && quality.contains("bake_cache_proofs.rs")
            && quality.contains("parallel PR git-scope isolation"),
        "cortex quality must document the runtime sim beside static theorems"
    );
}

fn assignment_mentions_cache_to(bake: &str, target: &str) -> bool {
    target_body(bake, target)
        .lines()
        .any(|line| line.trim_start().starts_with("cache-to"))
}

fn assignment_body<'a>(bake: &'a str, name: &str) -> &'a str {
    let marker = format!("{name} =");
    let rest = bake
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .unwrap_or_else(|| panic!("missing Bake assignment {name}"));
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
    rest[..end].trim()
}

fn target_body<'a>(bake: &'a str, name: &str) -> &'a str {
    let marker = format!("target \"{name}\"");
    let rest = bake
        .split_once(marker.as_str())
        .map(|(_, rest)| rest)
        .unwrap_or_else(|| panic!("missing Bake target {name}"));
    let start = rest
        .find('{')
        .unwrap_or_else(|| panic!("target {name} missing body"));
    let mut depth = 0usize;
    for (idx, ch) in rest[start..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return &rest[start..=start + idx];
                }
            }
            _ => {}
        }
    }
    panic!("target {name} body did not close");
}
