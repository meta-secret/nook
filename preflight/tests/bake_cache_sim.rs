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
        format!("{sim}/base.Dockerfile"),
        format!("{sim}/parent.Dockerfile"),
        format!("{sim}/parent-nested.Dockerfile"),
        format!("{sim}/combined-nightly.Dockerfile"),
        format!("{sim}/platform-nested.Dockerfile"),
        format!("{sim}/leaf.Dockerfile"),
        format!("{sim}/leaf-platform.Dockerfile"),
        format!("{sim}/inputs/base.txt"),
        format!("{sim}/inputs/parent.txt"),
        format!("{sim}/inputs/platform.txt"),
        format!("{sim}/inputs/leaf.txt"),
        format!("{sim}/inputs/consumer.txt"),
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
        bake.contains("target \"base\"")
            && bake.contains("target \"base-publish\"")
            && bake.contains("target \"parent\"")
            && bake.contains("target \"parent-publish\"")
            && bake.contains("target \"parent-input-publish\"")
            && bake.contains("target \"parent-input-verify\"")
            && bake.contains("target \"parent-nested\"")
            && bake.contains("target \"parent-nested-restore\"")
            && bake.contains("target \"parent-nested-importing\"")
            && bake.contains("target \"parent-nested-publish\"")
            && bake.contains("target \"platform-nested-broken\"")
            && bake.contains("target \"leaf-via-platform-broken\"")
            && bake.contains("target \"combined-leaf\"")
            && bake.contains("target \"combined-consumer\"")
            && bake.contains("target \"leaf\"")
            && bake.contains("target \"leaf-short-chain\"")
            && bake.contains("target \"parent-pr-cold\""),
        "sim Bake must expose restore/publish plus broken and fixed nested leaf topologies"
    );
    assert!(
        bake.contains("BASE_OWN_CACHE_ENABLED")
            && bake.contains("parent-publish")
            && bake.contains("cache-to = parent_cache_to")
            && !assignment_mentions_cache_to(&bake, "parent")
            && !assignment_mentions_cache_to(&bake, "base"),
        "publishers own cache-to; context base/parent must not"
    );
    let nested_parent = target_body(&bake, "parent-nested");
    let nested_restore = target_body(&bake, "parent-nested-restore");
    let combined_leaf = target_body(&bake, "combined-leaf");
    assert!(
        !nested_parent.lines().any(|line| {
            let line = line.trim_start();
            line.starts_with("cache-from") || line.starts_with("cache-to")
        }) && nested_restore.contains("cache-from = parent_nested_cache_from"),
        "nested context parent must be cache-free and its restore target must import the scope"
    );
    assert!(
        !combined_leaf.contains("contexts =")
            && read(&format!("{sim}/combined-nightly.Dockerfile")).contains("AS base"),
        "fixed control must keep base, parent, and leaf in one Dockerfile lineage"
    );
    let leaf_from = assignment_body(&bake, "leaf_cache_from");
    let nested_leaf_from = assignment_body(&bake, "nested_leaf_cache_from");
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
        leaf_from.contains("LEAF_EXACT_AVAILABLE")
            && nested_leaf_from.contains("NESTED_LEAF_EXACT_AVAILABLE")
            && tasks.contains("BAKE_SIM_LEAF_EXACT_AVAILABLE=1")
            && tasks.contains("BAKE_SIM_NESTED_LEAF_EXACT_AVAILABLE=1"),
        "source-leaf retries must import exact alone instead of merging exact with Main"
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
            && tasks.contains("Scenario K:")
            && tasks.contains("Scenario L:")
            && tasks.contains("Scenario M:")
            && tasks.contains("Scenario N:")
            && tasks.contains("Scenario O:")
            && tasks.contains("Scenario P: hosted-verified formatter deps feed fresh PR runner")
            && tasks.contains("Scenario Q: inline PR verification publishes Hive-style exact leaf")
            && tasks
                .contains("Scenario R: exact-only replay works across linked and internal parents")
            && tasks
                .contains("Scenario S: Kani-style full graph falls back once then replays exact")
            && tasks
                .contains("Scenario T: unverified local candidate cannot poison stable PR input")
            && tasks.contains("Scenario U: promoter setup failure leaves stable input intact")
            && tasks
                .contains("Scenario W: independent Node consumer owns and replays its exact leaf",)
            && tasks.contains("promote_registry_tag")
            && tasks.contains("bake-sim-base-layer")
            && tasks.contains("leaf-via-platform-broken")
            && tasks.contains("combined-leaf")
            && tasks.contains("parent-pr-cold")
            && tasks.contains("require_registry_ref")
            && tasks.contains("require_no_registry_ref")
            && tasks.contains("nook/remote-buildcache/")
            && bake.contains("PARENT_OWN_CACHE_ENABLED")
            && bake.contains("BASE_OWN_CACHE_ENABLED")
            && bake.contains("write_cache_repository"),
        "infra proof must cover FALLBACK, base orphan, PR isolation, local-to-PR reuse, Kani, Node consumer ownership, and the broken/fixed nightly leaf graph"
    );
    let parent_from = assignment_body(&bake, "parent_cache_from");
    assert!(
        parent_from.contains("nook/buildcache/nook-bake-sim-parent-v1")
            && parent_from.contains("nook-bake-sim-parent-v1${GHA_CACHE_SCOPE_SUFFIX}"),
        "sim cold parent scope must model exact and trusted Main candidates"
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
