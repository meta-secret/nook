use std::{env, fs, path::PathBuf};

struct RepositoryFixture(PathBuf);

impl RepositoryFixture {
    fn repository_root() -> Self {
        Self(env::var_os("NOOK_REPO_ROOT").map_or_else(
            || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        ))
    }

    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.0.join(path))
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
    }

    fn docker_stage<'a>(dockerfile: &'a str, stage: &str) -> &'a str {
        let marker = format!(" AS {stage}\n");
        let marker_start = dockerfile
            .find(&marker)
            .unwrap_or_else(|| panic!("Dockerfile stage must exist: {stage}"));
        let stage_start = dockerfile
            .get(..marker_start)
            .unwrap_or_else(|| panic!("Dockerfile marker must be valid UTF-8: {stage}"))
            .rfind("FROM ")
            .unwrap_or_else(|| panic!("Dockerfile stage must start with FROM: {stage}"));
        let remainder = dockerfile
            .get(stage_start..)
            .unwrap_or_else(|| panic!("Dockerfile stage must be valid UTF-8: {stage}"));
        remainder
            .split_once("\nFROM ")
            .map_or(remainder, |(body, _)| body)
    }
}

#[test]
fn remote_workflow_uses_only_scoped_external_cache_credentials() {
    let workflow = RepositoryFixture::repository_root().read(".github/workflows/remote.yml");
    for required in [
        "registry-username: ${{ secrets.NOOK_REGISTRY_REMOTE_USERNAME }}",
        "registry-password: ${{ secrets.NOOK_REGISTRY_REMOTE_PASSWORD }}",
        "sccache-access-key: ${{ secrets.NOOK_SCCACHE_ACCESS_KEY }}",
        "sccache-secret-key: ${{ secrets.NOOK_SCCACHE_SECRET_KEY }}",
        "sccache-endpoint: ${{ secrets.NOOK_SCCACHE_ENDPOINT }}",
        "sccache-bucket: ${{ secrets.NOOK_SCCACHE_BUCKET }}",
    ] {
        assert!(
            workflow.contains(required),
            "missing cache boundary: {required}"
        );
    }
    let secret_refs = workflow.matches("${{ secrets.").count();
    let allowed_secret_refs = workflow
        .matches("secrets.NOOK_REGISTRY_REMOTE_USERNAME")
        .count()
        + workflow
            .matches("secrets.NOOK_REGISTRY_REMOTE_PASSWORD")
            .count()
        + workflow.matches("secrets.NOOK_SCCACHE_ACCESS_KEY").count()
        + workflow.matches("secrets.NOOK_SCCACHE_SECRET_KEY").count()
        + workflow.matches("secrets.NOOK_SCCACHE_ENDPOINT").count()
        + workflow.matches("secrets.NOOK_SCCACHE_BUCKET").count();
    assert_eq!(secret_refs, allowed_secret_refs);
    assert!(!workflow.contains("${{ inputs.command }}"));
}

#[test]
fn focused_build_images_seal_source_and_dependency_artifacts() {
    let root = RepositoryFixture::repository_root();
    let dockerfile = root.read("nook-app/nook-platform/docker/rust/product.Dockerfile");
    let dockerignore =
        root.read("nook-app/nook-platform/docker/rust/product.Dockerfile.dockerignore");
    for ignored in [
        "**/docker-bake.hcl",
        "**/target",
        "**/node_modules",
        "**/dist",
    ] {
        assert!(dockerignore.lines().any(|line| line == ignored));
    }
    for (label, marker) in [
        ("test", "focused-native-test-compile"),
        ("lint", "focused-rust-lint-compile"),
        ("coverage", "focused-rust-coverage-compile"),
    ] {
        let stage = RepositoryFixture::docker_stage(&dockerfile, &format!("nook-rust-{label}"));
        assert!(stage.contains("COPY nook-app/nook-platform/nook-app-common nook-app-common"));
        assert!(stage.contains("COPY nook-app/nook-platform/nook-auth2 nook-auth2"));
        assert!(stage.contains("COPY nook-app/nook-platform/nook-core nook-core"));
        let compile = stage
            .find(marker)
            .unwrap_or_else(|| panic!("missing {marker}"));
        let sealed = stage
            .find("COPY . .")
            .unwrap_or_else(|| panic!("focused {label} must seal the checkout"));
        assert!(compile < sealed);
    }
    assert!(dockerfile.contains("FROM builder-wasm-build AS focused-web-artifacts-source"));
    assert!(dockerfile.contains("FROM scratch AS focused-web-artifacts"));
}

#[test]
fn pull_request_cache_credentials_cannot_write_main_scopes() {
    let pr = RepositoryFixture::repository_root().read(".github/workflows/pr.yml");
    assert!(!pr.contains("secrets.NOOK_REGISTRY_USERNAME"));
    assert!(!pr.contains("secrets.NOOK_REGISTRY_PASSWORD"));
    assert!(pr.contains("secrets.NOOK_REGISTRY_REMOTE_USERNAME"));
    assert!(pr.contains("secrets.NOOK_REGISTRY_REMOTE_PASSWORD"));
    let docker_setups = pr
        .matches("uses: ./.github/actions/nook-docker-setup")
        .count();
    assert_eq!(pr.matches("cache-write: \"false\"").count(), docker_setups);
    assert_eq!(
        pr.matches("isolated-cache-write: \"true\"").count(),
        docker_setups
    );
}
