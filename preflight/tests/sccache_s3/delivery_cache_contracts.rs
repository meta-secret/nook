#![allow(clippy::unnecessary_wraps)]

use std::{
    env, fs,
    ops::Deref,
    path::{Path, PathBuf},
};

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

impl RepositoryFixture {
    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.join(path))
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
    }
}

fn assert_delivery_cache_scope_contract() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    let setup = root.read(".github/actions/nook-docker-setup/action.yml");
    assert!(setup.contains("docker/login-action@v4"));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"));
    assert!(setup.contains("GHA_CACHE_WRITE_ENABLED=$cache_write_enabled"));
    assert!(!setup.contains("cache-selection"));
    assert!(!setup.contains("publish_exact_availability"));

    let bake = [
        root.read("nook-app/docker-bake.hcl"),
        root.read("nook-app/nook-platform/docker/rust/docker-bake.hcl"),
        root.read("nook-app/nook-web/docker/toolchain.docker-bake.hcl"),
        root.read("nook-app/nook-web/docker/web.docker-bake.hcl"),
        root.read("preflight/docker-bake.hcl"),
    ]
    .join("\n");
    assert!(bake.contains("cache-from ="));
    assert!(bake.contains("cache-to   ="));
    assert!(bake.contains("type=registry,ref="));
    assert!(bake.contains("ignore-error=true"));
    for forbidden in [
        "GHA_CACHE_EXACT_",
        "GHA_CACHE_MAIN_",
        "GHA_CACHE_FALLBACK_ENABLED",
        "GHA_CACHE_EXACT_PROBES_COMPLETE",
        "NOOK_RUST_DEPS_INPUT_FINGERPRINT",
    ] {
        assert!(
            !bake.contains(forbidden),
            "custom BuildKit selection remains: {forbidden}"
        );
    }
    Ok(())
}
#[test]
fn cache_hit_telemetry_distinguishes_compiler_and_buildkit_reuse() -> anyhow::Result<()> {
    let reporter = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/docker/sccache-report.sh");
    for required in [
        "--show-stats --stats-format=json",
        "NOOK_SCCACHE_STATS",
        "compile_requests",
        "requests_executed",
        "cache_hits",
        "cache_misses",
        "cache_errors",
        "cache_writes",
    ] {
        assert!(
            reporter.contains(required),
            "sccache reporter is missing safe counter: {required}"
        );
    }
    for forbidden in [
        "cache_location",
        "SCCACHE_REDIS_PASSWORD",
        "SCCACHE_REDIS_ENDPOINT",
        "AWS_SECRET_ACCESS_KEY",
        "SCCACHE_SECRET",
    ] {
        assert!(
            !reporter.contains(forbidden),
            "sccache telemetry must not emit backend details: {forbidden}"
        );
    }

    let rust_base = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    assert!(rust_base.contains("sccache-report.sh /usr/local/bin/nook-sccache-report"));
    let product = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    assert!(
        product.contains("nook-sccache-report"),
        "product.Dockerfile must report compiler cache outcomes"
    );
    assert!(
        RepositoryFixture::repository_root()
            .read("nook-app/nook-platform/docker/rust/product.Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 12
    );
    assert!(
        RepositoryFixture::repository_root()
            .read("nook-app/nook-platform/docker/rust/product.Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 3
    );

    assert_delivery_cache_scope_contract()?;

    let telemetry_action = RepositoryFixture::repository_root()
        .read(".github/actions/nook-cache-telemetry/action.yml");
    for required in [
        "cache-telemetry.mjs\" collect",
        "cache-telemetry-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}",
        "actions/upload-artifact@v7",
    ] {
        assert!(
            telemetry_action.contains(required),
            "cache telemetry action is missing: {required}"
        );
    }

    let pr = RepositoryFixture::repository_root().read(".github/workflows/pr.yml");
    let buildkit_jobs = pr
        .matches("uses: ./.github/actions/nook-docker-setup")
        .count();
    assert!(
        pr.matches("uses: ./.github/actions/nook-cache-telemetry")
            .count()
            == buildkit_jobs,
        "every Buildx-backed PR job must preserve cache telemetry"
    );
    let main = RepositoryFixture::repository_root().read(".github/workflows/main.yml");
    assert!(main.contains("uses: ./.github/actions/nook-cache-telemetry"));

    let main_stats =
        RepositoryFixture::repository_root().read(".github/workflows/main-build-stats.yml");
    for required in [
        "Download completed Main cache telemetry",
        "cache-telemetry-${{ github.event.workflow_run.id }}-${{ github.event.workflow_run.run_attempt }}-*",
        "cacheTelemetry",
    ] {
        assert!(
            main_stats.contains(required),
            "Main statistics must retain cache telemetry: {required}"
        );
    }
    Ok(())
}

#[test]
fn rust_build_targets_inherit_the_sccache_configuration() -> anyhow::Result<()> {
    for (path, targets) in [
        (
            "nook-app/nook-platform/nook-core/docker-bake.hcl",
            [
                "builder-core-deps",
                "builder-debug",
                "coverage-export",
                "_nook-rust-test-common",
            ]
            .as_slice(),
        ),
        (
            "nook-app/nook-platform/nook-wasm/docker-bake.hcl",
            [
                "builder-wasm",
                "web-artifacts",
                "_nook-rust-common",
                "_nook-rust-browser-common",
            ]
            .as_slice(),
        ),
    ] {
        let bake = RepositoryFixture::repository_root().read(path);
        for target in targets {
            let start = format!("target \"{target}\" {{");
            let body = bake
                .split_once(&start)
                .unwrap_or_else(|| panic!("missing target {target} in {path}"))
                .1
                .split_once("\n}")
                .unwrap_or_else(|| panic!("unterminated target {target} in {path}"))
                .0;
            assert!(
                body.contains("inherits") && body.contains("_sccache"),
                "{target} must inherit the sccache configuration"
            );
        }
    }
    Ok(())
}
