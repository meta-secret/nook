use nook_preflight::dockerfile_cache::DockerfileRepository;
use std::{env, fs, path::PathBuf};

#[test]
fn dockerfiles_do_not_use_buildkit_cache_mounts() -> anyhow::Result<()> {
    let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );

    let violations = DockerfileRepository::new(&repository_root).dockerfile_cache_mounts()?;

    assert!(
        violations.is_empty(),
        "Dockerfile cache mounts are prohibited; use ordinary immutable Docker layers instead:\n{}",
        violations
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(())
}

struct DockerfileFixture {
    source: String,
}

impl DockerfileFixture {
    fn compile() -> anyhow::Result<Self> {
        let repository_root = env::var_os("NOOK_REPO_ROOT").map_or_else(
            || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        );
        Ok(Self {
            source: fs::read_to_string(
                repository_root.join("nook-app/nook-platform/docker/rust/compile.Dockerfile"),
            )?,
        })
    }

    fn required_offset(&self, marker: &str, description: &str) -> anyhow::Result<usize> {
        self.source
            .find(marker)
            .ok_or_else(|| anyhow::anyhow!("{description}"))
    }

    fn required_offset_after(
        &self,
        start: usize,
        marker: &str,
        description: &str,
    ) -> anyhow::Result<usize> {
        let tail = self
            .source
            .get(start..)
            .ok_or_else(|| anyhow::anyhow!("invalid UTF-8 offset for {description}"))?;
        let offset = tail
            .find(marker)
            .ok_or_else(|| anyhow::anyhow!("{description}"))?;
        Ok(start + offset)
    }

    fn section(&self, start: usize, end: usize, description: &str) -> anyhow::Result<&str> {
        self.source
            .get(start..end)
            .ok_or_else(|| anyhow::anyhow!("invalid UTF-8 range for {description}"))
    }

    fn suffix(&self, start: usize, description: &str) -> anyhow::Result<&str> {
        self.source
            .get(start..)
            .ok_or_else(|| anyhow::anyhow!("invalid UTF-8 offset for {description}"))
    }
}

#[derive(Clone, Copy)]
struct DockerfileSection<'a> {
    name: &'static str,
    source: &'a str,
}

impl<'a> DockerfileSection<'a> {
    fn new(name: &'static str, source: &'a str) -> Self {
        Self { name, source }
    }

    fn required_offset_after(
        &self,
        start: usize,
        marker: &str,
        description: &str,
    ) -> anyhow::Result<usize> {
        let tail = self
            .source
            .get(start..)
            .ok_or_else(|| anyhow::anyhow!("invalid UTF-8 offset in {} stage", self.name))?;
        let offset = tail
            .find(marker)
            .ok_or_else(|| anyhow::anyhow!("{description}"))?;
        Ok(start + offset)
    }

    fn section(&self, start: usize, end: usize, description: &str) -> anyhow::Result<&'a str> {
        self.source
            .get(start..end)
            .ok_or_else(|| anyhow::anyhow!("invalid UTF-8 range for {description}"))
    }

    fn last_copy_for_group(&self, prior_build: usize, crates: &[&str]) -> anyhow::Result<usize> {
        let mut last_copy = None;
        for crate_name in crates {
            let marker = format!("COPY nook-app/nook-platform/{crate_name} {crate_name}");
            let copy = self.required_offset_after(
                prior_build,
                &marker,
                &format!("{} stage must copy {crate_name}", self.name),
            )?;
            last_copy = Some(last_copy.map_or(copy, |previous: usize| previous.max(copy)));
        }
        last_copy.ok_or_else(|| anyhow::anyhow!("{} stage has an empty build step", self.name))
    }
}

#[test]
fn compile_web_creates_package_directories_before_dependency_symlinks() -> anyhow::Result<()> {
    let dockerfile = DockerfileFixture::compile()?;
    let directory_setup = dockerfile.required_offset(
        concat!(
            "RUN mkdir -p \\\n",
            "      /meta-secret/nook/nook-app/nook-web/nook-vault-simple \\"
        ),
        "compile-web must create package directories",
    )?;
    let dependency_symlinks = dockerfile.required_offset(
        "&& ln -s nook-web-app/node_modules /meta-secret/nook/nook-app/nook-web/node_modules",
        "compile-web must link shared dependencies",
    )?;
    let source_copy =
        dockerfile.required_offset("COPY . .", "compile-web must copy the repository source")?;
    let package_setup = dockerfile.section(
        directory_setup,
        dependency_symlinks,
        "compile-web package setup",
    )?;

    assert!(
        package_setup.contains("/meta-secret/nook/nook-app/nook-web/nook-vault-sentinel \\")
            && package_setup.contains("/meta-secret/nook/nook-app/nook-web/nook-web-extension \\"),
        "compile-web must create every package directory that receives a dependency symlink"
    );
    assert!(
        directory_setup < dependency_symlinks && dependency_symlinks < source_copy,
        "compile-web must create package directories before linking dependencies and copying source"
    );
    Ok(())
}

#[test]
fn compile_web_flattens_generated_wasm_packages_into_import_destinations() -> anyhow::Result<()> {
    let dockerfile = DockerfileFixture::compile()?;
    let web_stage_start = dockerfile.required_offset(
        "FROM web-base AS compile-web",
        "compile Dockerfile must retain the web stage",
    )?;
    let web_stage = dockerfile.suffix(web_stage_start, "compile-web stage")?;

    assert!(
        dockerfile
            .source
            .contains("prod) wasm_opt_flag=\"\"; stamp_mode=\"optimized\" ;;")
            && dockerfile
                .source
                .contains("dev) wasm_opt_flag=\"--no-opt\"; stamp_mode=\"no-opt\" ;;"),
        "compile-wasm-source must map each WASM build mode to its isolation verifier stamp"
    );
    assert!(
        dockerfile.source.contains(concat!(
            "printf '%s\\n' \"$stamp_mode\" > ",
            "/opt/nook/wasm-handoff/nook-wasm/nook-wasm-build-mode"
        )),
        "compile-wasm-source must include the selected build mode in its handoff"
    );
    assert!(
        web_stage.contains(concat!(
            "cp -a /tmp/nook-wasm-handoff/nook-wasm/. \\\n",
            "      nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/"
        )),
        "compile-web must place nook_wasm.js directly in the vault-app nook-wasm import destination"
    );
    assert!(
        web_stage.contains(concat!(
            "cp -a /tmp/nook-wasm-handoff/nook-companion-wasm/. \\\n",
            "      nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/"
        )),
        "compile-web must retain the flattened companion WASM handoff"
    );
    assert!(
        web_stage.contains(concat!(
            "test -f ",
            "nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js"
        )),
        "compile-web must require nook_wasm.js at the web import destination"
    );
    assert!(
        !web_stage.contains(
            "-exec cp -a {} nook-app/nook-web/nook-web-shared/src/vault-app/lib/nook-wasm/"
        ),
        "compile-web must not nest the nook-wasm handoff directory inside its import destination"
    );
    Ok(())
}

#[test]
fn compile_loom_copies_imported_cortex_sources_after_installing_dependencies() -> anyhow::Result<()>
{
    let dockerfile = DockerfileFixture::compile()?;
    let loom_stage = dockerfile.required_offset(
        "FROM web-base AS compile-loom",
        "compile Dockerfile must retain the Loom stage",
    )?;
    let dependency_install = dockerfile.required_offset_after(
        loom_stage,
        "RUN bun install --frozen-lockfile --ignore-scripts",
        "compile-loom must install its locked dependencies",
    )?;
    let loom_source = dockerfile.required_offset_after(
        loom_stage,
        "COPY agentic-ai/loom/src src",
        "compile-loom must copy Loom source",
    )?;
    let compilation = dockerfile.required_offset_after(
        loom_stage,
        "node_modules/.bin/tsc --noEmit -p tsconfig.compile.json",
        "compile-loom must type-check Loom",
    )?;
    let loom_section = dockerfile.section(loom_stage, compilation, "compile-loom")?;

    for skill in [
        "cortex-article-structure",
        "cortex-consistency",
        "cortex-document-map",
    ] {
        let source_copy = format!(
            "COPY .cortex/teams/ai/dynamic-skills/{skill}/scripts/src \\\n  /meta-secret/nook/.cortex/teams/ai/dynamic-skills/{skill}/scripts/src"
        );
        let source_copy_offset = dockerfile.required_offset_after(
            loom_stage,
            &source_copy,
            &format!("compile-loom must copy {skill} source"),
        )?;
        assert!(
            dependency_install < source_copy_offset && source_copy_offset < compilation,
            "compile-loom must copy {skill} after dependency installation and before compilation"
        );
    }
    assert!(
        dependency_install < loom_source && loom_source < compilation,
        "compile-loom must install dependencies before source copies and compile afterward"
    );
    assert!(
        loom_section.contains("ln -s agentic-ai/loom/node_modules /meta-secret/nook/node_modules"),
        "compile-loom must expose Loom dependencies to imported Cortex sources"
    );
    Ok(())
}

#[test]
fn compile_rust_source_stages_invalidate_stub_artifacts_after_every_crate_copy()
-> anyhow::Result<()> {
    let dockerfile = DockerfileFixture::compile()?;
    let native_start = dockerfile.required_offset(
        "FROM compile-native-dependencies AS compile-native-source",
        "compile Dockerfile must retain the native source stage",
    )?;
    let wasm_start = dockerfile.required_offset(
        "FROM compile-wasm-dependencies AS compile-wasm-source",
        "compile Dockerfile must retain the WASM source stage",
    )?;
    let web_start = dockerfile.required_offset(
        "FROM web-base AS compile-web",
        "compile Dockerfile must retain the web stage",
    )?;
    let native_stage = DockerfileSection::new(
        "native",
        dockerfile.section(native_start, wasm_start, "native source stage")?,
    );
    let wasm_stage = DockerfileSection::new(
        "WASM",
        dockerfile.section(wasm_start, web_start, "WASM source stage")?,
    );

    for (stage_name, stage, crate_groups) in [
        (
            "native",
            native_stage,
            &[
                &["nook-app-common"][..],
                &["nook-authenticator-domain", "nook-auth2"],
                &["nook-replication"],
                &["nook-event-log"],
                &["nook-companion-core"],
                &["nook-core"],
            ][..],
        ),
        (
            "WASM",
            wasm_stage,
            &[
                &["nook-app-common"][..],
                &["nook-authenticator-domain", "nook-auth2"],
                &["nook-replication"],
                &["nook-event-log"],
                &["nook-companion-core"],
                &["nook-core"],
                &["nook-companion-wasm"],
                &["nook-wasm"],
            ][..],
        ),
    ] {
        let expected_copy_count = crate_groups
            .iter()
            .map(|crates| crates.len())
            .sum::<usize>();
        let actual_copy_count = stage
            .source
            .lines()
            .filter(|line| line.starts_with("COPY nook-app/nook-platform/nook-"))
            .count();
        assert_eq!(
            actual_copy_count, expected_copy_count,
            "{stage_name} stage crate COPY inventory must stay covered by the freshness contract"
        );

        let mut prior_build = 0;
        for crates in crate_groups {
            let last_copy = stage.last_copy_for_group(prior_build, crates)?;
            let build = stage.required_offset_after(
                last_copy,
                "cargo build --locked",
                &format!("{stage_name} stage must build after its crate copies"),
            )?;
            let invalidation = stage.section(
                last_copy,
                build,
                &format!("{stage_name} source invalidation"),
            )?;

            for crate_name in *crates {
                assert!(
                    invalidation.contains(&format!("{crate_name}/src/lib.rs")),
                    "{stage_name} stage must touch {crate_name}/src/lib.rs after copying real sources and before building"
                );
            }
            prior_build = build + "cargo build --locked".len();
        }
    }
    Ok(())
}
