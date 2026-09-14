use super::*;

struct RustCacheLineageContract<'a> {
    root: &'a Path,
}

impl<'a> RustCacheLineageContract<'a> {
    fn new(root: &'a Path) -> Self {
        Self { root }
    }

    fn read_sre_cortex(&self) -> anyhow::Result<String> {
        let mut pending = vec![self.root.join(".cortex/teams/sre")];
        let mut markdown = Vec::new();
        while let Some(path) = pending.pop() {
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                } else if path.extension().is_some_and(|extension| extension == "md") {
                    markdown.push(path);
                }
            }
        }
        markdown.sort();
        markdown
            .into_iter()
            .map(fs::read_to_string)
            .collect::<Result<Vec<_>, _>>()
            .map(|documents| documents.join("\n"))
            .map_err(Into::into)
    }

    #[expect(
        clippy::too_many_lines,
        reason = "one lineage contract verifies the complete cache rotation"
    )]
    fn assert_one_rotated_forced_zstd_generation(&self) -> anyhow::Result<()> {
        let rust_bake = self
            .root
            .read("nook-app/nook-platform/docker/rust/docker-bake.hcl");
        let setup = self
            .root
            .read(".github/actions/nook-docker-setup/action.yml");
        let verifier = self.root.read(".github/scripts/verify-wasm-gha-cache.sh");
        let fingerprint = self
            .root
            .read(".github/scripts/rust-deps-cache-fingerprint.sh");
        let promoter = self.root.read(".github/scripts/rust-deps-cache-promote.sh");
        let root_tasks = self.root.read("Taskfile.yml");
        let sre_cortex = self.read_sre_cortex()?;
        let contract = format!(
            "{rust_bake}\n{setup}\n{verifier}\n{fingerprint}\n{promoter}\n{root_tasks}\n{sre_cortex}"
        );

        let registry_writers = rust_bake
            .lines()
            .filter(|line| line.contains("type=registry,ref=") && line.contains("timeout=10m"))
            .collect::<Vec<_>>();
        assert_eq!(
            registry_writers.len(),
            12,
            "the Rust Bake family must keep the complete writer inventory explicit"
        );
        assert!(
            registry_writers.iter().all(|line| {
                line.contains("compression=zstd,force-compression=true")
                    && (line.contains("mode=${GHA_CACHE_EXPORT_MODE}") || line.contains("mode=max"))
            }),
            "every Rust/WASM registry writer must force zstd in the same generation"
        );

        let active_refs = [
            "nook-rust-base-v2",
            "nook-rust-ecosystem-dylint-v4",
            "nook-rust-ecosystem-fuzz-v4",
            "nook-rust-ecosystem-policy-tools-v5",
            "nook-rust-ecosystem-deterministic-v2",
            "nook-rust-ecosystem-kani-v2",
            "nook-rust-deps-v4",
            "nook-rust-native-deps-input-v3",
            "nook-rust-wasm-deps-v6",
            "nook-rust-wasm-deps-input-v3",
            "nook-rust-native-source-v4",
            "nook-rust-wasm-source-v3",
        ];
        for current in &active_refs {
            assert!(
                contract.contains(*current),
                "rotated Rust/WASM cache contract is missing {current}"
            );
        }
        for retired in [
            "nook-rust-base-v1",
            "nook-rust-ecosystem-dylint-v3",
            "nook-rust-ecosystem-fuzz-v3",
            "nook-rust-ecosystem-policy-tools-v4",
            "nook-rust-ecosystem-deterministic-v1",
            "nook-rust-ecosystem-kani-v1",
            "nook-rust-deps-v3",
            "nook-rust-native-deps-input-v2",
            "nook-rust-wasm-deps-v5",
            "nook-rust-wasm-deps-input-v2",
            "nook-rust-native-source-v3",
            "nook-rust-wasm-source-v2",
            "nook-rust-wasm-node-v1",
            "nook-rust-wasm-node-v2",
        ] {
            assert!(
                !contract.contains(retired),
                "rotated Rust/WASM contract must not import retired mixed-compression ref {retired}"
            );
        }
        let documented_refs = sre_cortex
            .split(|character: char| !(character.is_ascii_alphanumeric() || character == '-'))
            .filter(|token| {
                token.starts_with("nook-rust-")
                    && token.rsplit_once("-v").is_some_and(|(_, generation)| {
                        !generation.is_empty()
                            && generation
                                .chars()
                                .all(|character| character.is_ascii_digit())
                    })
            })
            .collect::<Vec<_>>();
        assert!(
            !documented_refs.is_empty(),
            "owning SRE Cortex must retain explicit operational cache references"
        );
        for documented in documented_refs {
            assert!(
                active_refs.contains(&documented),
                "owning SRE Cortex names a cache ref outside the active forced-zstd generation: {documented}"
            );
        }
        assert!(
            fingerprint.contains("nook-rust-deps-input-v3")
                && verifier.contains("compression=zstd,force-compression=true")
                && verifier.contains("nook-rust-wasm-deps-input-v3")
                && verifier.contains("nook-rust-wasm-source-v3"),
            "fingerprint and portable WASM proof must share the rotated forced-zstd generation"
        );
        assert!(
            promoter.contains("for graph in native wasm")
                && promoter.contains("nook-rust-${graph}-deps-input-v3")
                && !promoter.contains("nook-rust-${graph}-deps-input-v2"),
            "native and WASM dependency promotion must target only the rotated repository generation"
        );
        Ok(())
    }
}

#[test]
fn rust_cache_lineage_uses_one_rotated_forced_zstd_generation() -> anyhow::Result<()> {
    let root = RepositoryFixture::repository_root();
    RustCacheLineageContract::new(&root).assert_one_rotated_forced_zstd_generation()
}
