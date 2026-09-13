use std::path::{Path, PathBuf};
use std::{env, fs, ops::Deref};

struct RepositoryFixture {
    path: PathBuf,
}

impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }

    fn read(&self, relative_path: &str) -> String {
        fs::read_to_string(self.join(relative_path))
            .unwrap_or_else(|error| panic!("failed to read {relative_path}: {error}"))
    }
}

impl Deref for RepositoryFixture {
    type Target = PathBuf;

    fn deref(&self) -> &PathBuf {
        &self.path
    }
}

impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

#[test]
fn bake_cache_sim_proves_stable_rust_dependency_replay() {
    let fixture = RepositoryFixture::repository_root();
    let sim = "infra/sim/bake-cache";
    for path in [
        format!("{sim}/zot-config.json"),
        format!("{sim}/rust-deps-replay.docker-bake.hcl"),
        format!("{sim}/hive.Dockerfile"),
        format!("{sim}/inputs/base.txt"),
        format!("{sim}/inputs/parent.txt"),
        format!("{sim}/inputs/crate-a.txt"),
        format!("{sim}/inputs/crate-b.txt"),
        format!("{sim}/inputs/leaf.txt"),
    ] {
        assert!(fixture.join(&path).is_file(), "missing bake-cache fixture {path}");
    }

    let bake = fixture.read(&format!("{sim}/rust-deps-replay.docker-bake.hcl"));
    let tasks = fixture.read("infra/tasks/bake-cache.yml");
    let hive = fixture.read(&format!("{sim}/hive.Dockerfile"));
    let zot = fixture.read(&format!("{sim}/zot-config.json"));

    assert!(
        zot.contains("\"compat\": [\"docker2s2\"]") && zot.contains("anonymousPolicy"),
        "sim Zot must allow anonymous docker2s2 push/pull"
    );
    assert!(
        bake.contains("target \"rust-deps-replay\"")
            && bake.contains("nook/buildcache/nook-bake-sim-rust-deps-v1:buildcache")
            && bake.matches("type=registry,ref=${rust_deps_cache_ref}").count() == 2
            && bake.contains("mode=max")
            && !bake.contains("branch")
            && !bake.contains("SHA")
            && !bake.contains("fingerprint"),
        "plain proof must use one stable registry ref and native BuildKit digests"
    );
    assert!(
        hive.contains("AS fetched-dependencies")
            && hive.contains("AS test-dependencies")
            && hive.contains("AS clippy-dependencies")
            && hive.contains("COPY inputs/leaf.txt /tmp/hive-source")
            && hive.matches("bake-sim-hive-").count() >= 6,
        "Rust simulator must separate source-free dependency vertices from source vertices"
    );
    assert!(
        tasks.contains("bake-cache:prove:")
            && tasks.contains("rust-deps-replay.docker-bake.hcl")
            && tasks.contains("buildx create")
            && tasks.contains("network create")
            && tasks.contains("require_cached_step")
            && tasks.contains("require_uncached_step")
            && tasks.contains("require_cache_write")
            && tasks.contains("bake-sim-hive-toolchain")
            && tasks.contains("bake-sim-hive-cargo-fetch")
            && tasks.contains("bake-sim-hive-test-dependencies")
            && tasks.contains("bake-sim-hive-clippy-dependencies")
            && tasks.contains("bake-sim-hive-test-source")
            && tasks.contains("bake-sim-hive-clippy-source")
            && tasks.contains("rust-source-only-edit")
            && tasks.contains("cached=4 uncached=2")
            && tasks.contains("cached=6 uncached=0")
            && !tasks.contains("RUST_DEPS_INPUT_FINGERPRINT")
            && !tasks.contains("GHA_CACHE_SCOPE_SUFFIX")
            && !tasks.contains("-git-")
            && !tasks.contains("Scenario "),
        "runtime proof must cover cold, source-only, and no-op native replay only"
    );
}
