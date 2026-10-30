#![allow(clippy::unnecessary_wraps)]

use std::{
    env, fs,
    ops::Deref,
    path::{Path, PathBuf},
};

use anyhow::Context;

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
    assert!(setup.contains("--password-stdin"));
    assert!(!setup.contains("docker/login-action"));
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
        "local_hits",
        "remote_hits",
        "local_writes",
        "remote_writes",
        "local_write_errors",
        "remote_write_errors",
        "local_backfills",
        "compile_fails",
        "--stop-server",
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
        .read("nook-app/nook-platform/docker/rust/base/Dockerfile");
    assert!(rust_base.contains("sccache-report.sh /usr/local/bin/nook-sccache-report"));
    let product = RepositoryFixture::repository_root()
        .read("nook-app/nook-platform/docker/rust/base/Dockerfile");
    assert!(
        product.contains("nook-sccache-report"),
        "rust/base/Dockerfile must report compiler cache outcomes"
    );
    assert!(
        RepositoryFixture::repository_root()
            .read("nook-app/nook-platform/docker/rust/base/Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 12
    );
    assert!(
        RepositoryFixture::repository_root()
            .read("nook-app/nook-platform/docker/rust/base/Dockerfile")
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
    assert!(
        !pr.contains("uses: ./.github/actions/nook-cache-telemetry"),
        "PR validation must not spend a minute collecting cache telemetry artifacts"
    );
    let main = RepositoryFixture::repository_root().read(".github/workflows/main.yml");
    assert!(main.contains("uses: ./.github/actions/nook-cache-telemetry"));

    Ok(())
}

#[test]
fn rust_compiler_snapshots_keep_local_cache_writes_in_private_image_layers() {
    let root = RepositoryFixture::repository_root();
    let rust_base = root.read("nook-app/nook-platform/docker/rust/base/Dockerfile");
    for required in [
        "ENV SCCACHE_MULTILEVEL_CHAIN=disk,s3",
        "ENV SCCACHE_DIR=/opt/nook/sccache",
        "ENV SCCACHE_MULTILEVEL_WRITE_ERROR_POLICY=all",
        "ENV SCCACHE_CLIENT_SIDE=0",
    ] {
        assert!(
            rust_base.contains(required),
            "compiler snapshots must keep strict disk/S3 configuration: {required}"
        );
    }

    for path in [
        "nook-app/nook-platform/docker/rust/base/Dockerfile",
        "nook-app/nook-platform/docker/rust/compile/Dockerfile",
        "preflight/Dockerfile",
    ] {
        let source = root.read(path);
        assert!(
            !source.contains("--mount=type=cache"),
            "{path} must snapshot local compiler objects through ordinary private image layers"
        );
        let runs = super::dockerfile_run_instructions(&source);
        let reports = runs
            .iter()
            .filter(|run| run.contains("nook-sccache-report ") && !run.contains("--replay"))
            .collect::<Vec<_>>();
        assert!(
            !reports.is_empty(),
            "{path} must expose compiler snapshot completion points"
        );
        for run in reports {
            assert!(
                run.contains("nook-sccache-report --finish ")
                    || run.contains("nook-sccache-report --require --finish "),
                "{path} must finish its compiler daemon before committing a reported snapshot: {run}"
            );
        }
    }
}

#[test]
fn plain_cargo_dependency_parents_preserve_workspace_inputs_before_real_sources()
-> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    for path in [
        "nook-app/nook-platform/docker/rust/base/Dockerfile",
        "nook-app/nook-platform/docker/rust/compile/Dockerfile",
    ] {
        let source = root.read(path);
        let (manifests, _) = source
            .split_once("RUN --network=default RUSTC_WRAPPER= cargo fetch --locked")
            .with_context(|| {
                format!("{path} must fetch the manifest-only workspace before compiling")
            })?;
        for required in [
            "COPY nook-app/nook-platform/.cargo .cargo",
            "COPY nook-app/nook-platform/.config .config",
            "COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./",
            "src/lib.rs",
        ] {
            assert!(manifests.contains(required), "{path} is missing {required}");
        }
        for member in [
            "nook-app-common",
            "nook-authenticator-domain",
            "nook-auth2",
            "nook-replication",
            "nook-event-log",
            "nook-companion-core",
            "nook-core",
            "nook-companion-wasm",
            "nook-wasm",
            "nook-wasm-composition-tests",
        ] {
            assert!(
                manifests.contains(&format!(
                    "COPY nook-app/nook-platform/{member}/Cargo.toml {member}/Cargo.toml"
                )),
                "{path} must preserve the real {member} manifest before creating placeholder roots"
            );
            assert!(
                !manifests.contains(&format!("COPY nook-app/nook-platform/{member} {member}")),
                "{path} dependency warmup must precede the real {member} source overlay"
            );
        }
        assert!(!source.contains("cargo chef"));
        assert!(!source.contains("recipe.json"));
    }
    Ok(())
}

#[test]
fn rust_build_targets_inherit_the_sccache_configuration() -> anyhow::Result<()> {
    let shared = RepositoryFixture::repository_root().read("nook-app/docker-bake.hcl");
    for secret_id in ["id=sccache_s3_access_key", "id=sccache_s3_secret_key"] {
        assert!(
            shared.contains(secret_id),
            "shared _sccache target must pass the stable secret ID: {secret_id}"
        );
    }
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
                "rust-format-check",
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
