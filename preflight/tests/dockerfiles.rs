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
    let source_copy = dockerfile.required_offset(
        "COPY nook-app/nook-web nook-app/nook-web",
        "compile-web must copy the web workspace source",
    )?;
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
        "compile-web must create package directories before linking dependencies and copying the web workspace"
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
        web_stage.contains("&& rm -rf /tmp/nook-wasm-handoff"),
        "compile-web must consume and remove the temporary WASM handoff after flattening it"
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
fn compile_loom_copies_imported_cortex_sources_before_compilation() -> anyhow::Result<()> {
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

    let cortex_source = dockerfile.required_offset_after(
        loom_stage,
        "COPY .cortex /meta-secret/nook/.cortex",
        "compile-loom must copy its imported Cortex sources",
    )?;
    assert!(
        loom_source < dependency_install
            && cortex_source < dependency_install
            && dependency_install < compilation,
        "compile-loom must copy imported sources, install dependencies, and then compile"
    );
    assert!(
        loom_section.contains(concat!(
            "ln -s /meta-secret/nook/agentic-ai/loom/node_modules \\\n",
            "      /meta-secret/nook/.cortex/teams/ai/dynamic-skills/",
            "cortex-article-structure/scripts/node_modules"
        )) && loom_section.contains(concat!(
            "ln -s /meta-secret/nook/agentic-ai/loom/node_modules \\\n",
            "      /meta-secret/nook/.cortex/teams/ai/dynamic-skills/",
            "cortex-document-map/scripts/node_modules"
        )),
        "compile-loom must expose Loom dependencies to each imported Cortex compiler"
    );
    Ok(())
}
