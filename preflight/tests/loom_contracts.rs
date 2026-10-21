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

#[test]
fn preflight_pins_downloaded_toolchain_artifacts() {
    let dockerfile = RepositoryFixture::repository_root().read("preflight/Dockerfile");
    assert!(
        dockerfile.contains("mise_version=v2026.9.13")
            && dockerfile.contains(
                "mise_asset_url=\"https://github.com/jdx/mise/releases/download/${mise_version}/mise-${mise_version}-linux-x64\""
            ),
        "Docker preflight must pin mise v2026.9.13 to its official Linux x64 release asset"
    );
    let mise_sha256 = "a72f49916b33ba952ba398046c5cc91a58238f0b718fee1d938206ef2af21c6d";
    assert!(
        dockerfile.contains(&format!("mise_sha256={mise_sha256}"))
            && dockerfile
                .contains("printf '%s  %s\\n' \"$mise_sha256\" /tmp/mise | sha256sum --check -"),
        "Docker preflight must verify the pinned official mise SHA-256 before installation"
    );
    let bun_image_pin = "registry.dev.nokey.sh/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4";
    let vale_asset_pin = "https://github.com/vale-cli/vale/releases/download/v3.22.0/vale_3.22.0_Linux_64-bit.tar.gz";
    let vale_sha256 = "52f5cd0314a1b7384cac6aa102a68193977312f6ba9c9f3ae001b5deec8e3a10";
    assert!(
        dockerfile.contains(bun_image_pin),
        "Docker preflight must stage Bun from the pinned 1.3.14 image"
    );
    assert!(
        dockerfile.contains(vale_asset_pin)
            && dockerfile.contains(&format!("{vale_sha256}  /tmp/vale.tar.gz")),
        "Docker preflight must stage Vale from its pinned, checksum-verified 3.22.0 release"
    );
    assert_eq!(
        RepositoryFixture::repository_root()
            .read(".meta-cortex-version")
            .trim(),
        "0.21.0",
        "Meta-Cortex project wrapper must pin the official 0.21.0 release"
    );
}

#[test]
fn repository_policy_pins_meta_cortex_library_to_the_selected_commit() {
    let root = RepositoryFixture::repository_root();
    let workflow = root.read(".github/workflows/repository-policy.yml");
    let taskfile = root.read(".task/ci-workflows.yml");
    let expected_commit = "9d00b7d1a600446233c37b2434aba907272ab6cb";
    let workflow_checkout = format!(
        "          repository: ai-ai-ai-ai-ai-ai-ai/meta-cortex\n          ref: {expected_commit}\n          path: .meta-cortex-source"
    );
    let task_checkout =
        format!("test \"$(git -C .meta-cortex-source rev-parse HEAD)\" = {expected_commit}");

    assert!(
        workflow.contains(&workflow_checkout),
        "repository policy must checkout the selected Meta-Cortex library commit"
    );
    assert!(
        taskfile.contains(&task_checkout),
        "repository policy staging must require the selected Meta-Cortex library commit"
    );
}
