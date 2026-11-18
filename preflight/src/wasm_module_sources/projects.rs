use super::inputs::ModuleInputs;
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Keep the importing application's project throughout its re-export graph.
#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
pub(super) enum WebSurface {
    App,
    AppTest,
    Vault,
    Sentinel,
    Research,
    ExtensionRuntime,
    MockAuth,
    Standalone(Option<PathBuf>),
}

#[derive(Clone)]
pub(crate) struct WebWorkspace {
    pub(crate) root: PathBuf,
    pub(crate) web: PathBuf,
}

impl WebWorkspace {
    pub(crate) fn at(root: &Path) -> io::Result<Self> {
        let root = root.canonicalize()?;
        let web = root.join("nook-app/nook-web");
        Ok(Self { root, web })
    }
}

impl WebWorkspace {
    fn surfaces(&self, path: &Path) -> Vec<WebSurface> {
        if path.starts_with("nook-web-shared/src/vault-app") {
            return vec![WebSurface::Vault, WebSurface::Sentinel, WebSurface::App];
        }
        if path.starts_with("nook-web-app/tests/unit") {
            return vec![WebSurface::AppTest];
        }
        if path.starts_with("nook-web-app") {
            return vec![WebSurface::App];
        }
        if path.starts_with("nook-vault-sentinel") {
            return vec![WebSurface::Sentinel];
        }
        if path.starts_with("nook-web-research") {
            return vec![WebSurface::Research];
        }
        if path.starts_with("nook-web-extension/e2e/mock-auth/src") {
            return vec![WebSurface::MockAuth];
        }
        if path.starts_with("nook-web-extension/src") || path.starts_with("nook-web-shared") {
            return vec![WebSurface::ExtensionRuntime];
        }
        if path.starts_with("nook-vault-simple") || path.starts_with("nook-web-extension") {
            return vec![WebSurface::Vault];
        }

        // A standalone project's tsconfig belongs to that project alone.
        let config = path
            .parent()
            .and_then(|p| p.components().next())
            .map(|member| self.web.join(member).join("tsconfig.json"))
            .filter(|path| path.is_file());
        vec![WebSurface::Standalone(config)]
    }
}

impl WebSurface {
    pub(super) fn paths(&self, web: &Path) -> Option<PathBuf> {
        let config = match self {
            Self::App | Self::AppTest => "nook-web-app/module-paths.json",
            Self::Vault => "nook-web-shared/vault-module-paths.json",
            Self::Sentinel => "nook-vault-sentinel/module-paths.json",
            Self::Research => "nook-web-research/module-paths.json",
            Self::ExtensionRuntime | Self::MockAuth => return None,
            Self::Standalone(config) => return config.clone(),
        };
        Some(web.join(config))
    }

    // Only wasm-bindgen outputs may be absent in a sealed source checkout.
    // Keep TypeScript's declarations and Vitest/mock-auth's JavaScript entries distinct.
    pub(super) fn generated_entry(&self, module: &str) -> Option<&'static str> {
        match (self, module) {
            (Self::AppTest | Self::MockAuth, "nook-wasm") => Some("js"),
            (Self::App | Self::Standalone(_), "nook-wasm")
            | (
                Self::App | Self::AppTest | Self::Vault | Self::Sentinel | Self::Standalone(_),
                "$app-wasm",
            ) => Some("d.ts"),
            _ => None,
        }
    }
}

pub(crate) struct WebProject {
    pub(crate) files: Vec<PathBuf>,
    pub(crate) inputs: ModuleInputs,
}

impl WebWorkspace {
    pub(crate) fn collect(&self, files: Vec<PathBuf>) -> io::Result<Vec<WebProject>> {
        // Generated declarations and JS can be large. Keep their installed exports
        // in this scan's shared snapshot, without requiring either file to exist.
        let generated = super::GENERATED_WASM_PATHS.iter().flat_map(|path| {
            ["js", "d.ts"].map(|extension| self.web.join(path).with_extension(extension))
        });
        let parsed = Rc::new(ModuleInputs::parse(files.iter().cloned().chain(generated)));
        let mut groups = BTreeMap::<WebSurface, Vec<PathBuf>>::new();
        for path in files {
            let relative = path.strip_prefix(&self.web).map_err(io::Error::other)?;
            for surface in self.surfaces(relative) {
                groups.entry(surface).or_default().push(path.clone());
            }
        }
        groups
            .into_iter()
            .map(|(surface, files)| {
                let resolver = self.resolver(surface)?;
                Ok(WebProject {
                    files,
                    inputs: ModuleInputs {
                        modules: Rc::clone(&parsed),
                        resolver,
                    },
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::WebWorkspace;
    use std::collections::BTreeSet;
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};

    struct Consumer<'a> {
        ws: &'a WebWorkspace,
        path: PathBuf,
    }

    impl WebWorkspace {
        fn repository() -> anyhow::Result<Self> {
            let root = env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            );
            Ok(Self::at(&root)?)
        }

        fn consumer(&self, relative: &str) -> Consumer<'_> {
            Consumer {
                ws: self,
                path: self.web.join(relative),
            }
        }
    }

    impl Consumer<'_> {
        fn targets(&self, specifier: &str) -> anyhow::Result<BTreeSet<PathBuf>> {
            let path = &self.path;
            assert!(path.is_file(), "missing consumer {}", path.display());
            let mut targets = BTreeSet::new();
            for project in self.ws.collect(vec![path.clone()])? {
                if let Ok(target) = project.inputs.source(path).resolve(specifier) {
                    targets.insert(target.strip_prefix(&self.ws.web)?.to_path_buf());
                }
            }
            Ok(targets)
        }
    }

    #[test]
    fn shared_session_uses_each_vaults_extension_connection() -> anyhow::Result<()> {
        let checkout = WebWorkspace::repository()?;
        assert_eq!(
            checkout
                .consumer("nook-web-shared/src/vault-app/lib/vault/session.ts")
                .targets("$lib/extension/connect")?,
            BTreeSet::from([
                PathBuf::from("nook-vault-sentinel/src/extension-connect-disabled.ts"),
                PathBuf::from("nook-web-shared/src/vault-app/lib/extension/connect.ts"),
            ])
        );
        Ok(())
    }

    #[test]
    fn research_and_extension_use_their_own_project_paths() -> anyhow::Result<()> {
        let checkout = WebWorkspace::repository()?;
        assert_eq!(
            checkout
                .consumer("nook-web-research/src/App.svelte")
                .targets("$lib/components/ui/button")?,
            BTreeSet::from([PathBuf::from(
                "nook-web-research/src/lib/components/ui/button/index.ts"
            )])
        );
        assert_eq!(
            checkout
                .consumer("nook-web-extension/scripts/build.ts")
                .targets("$lib/extension/connect.js")?,
            BTreeSet::from([PathBuf::from(
                "nook-web-shared/src/vault-app/lib/extension/connect.ts"
            )])
        );
        assert!(
            checkout
                .consumer("nook-web-extension/src/manifest.ts")
                .targets("$lib/extension/connect")?
                .is_empty()
        );
        Ok(())
    }

    #[test]
    fn generated_wasm_retains_the_selected_type_or_runtime_entry_without_a_build()
    -> anyhow::Result<()> {
        let checkout = WebWorkspace::repository()?;
        let wasm = Path::new(super::super::VAULT_WASM_PATH);
        for (source, specifier, extension) in [
            ("nook-web-app/src/main.ts", "$app-wasm", "d.ts"),
            ("nook-web-app/src/main.ts", "nook-wasm", "d.ts"),
            ("nook-web-app/tests/unit/setup-wasm.ts", "nook-wasm", "js"),
            (
                "nook-web-extension/e2e/mock-auth/src/lib/totp.ts",
                "nook-wasm",
                "js",
            ),
        ] {
            assert_eq!(
                checkout.consumer(source).targets(specifier)?,
                BTreeSet::from([wasm.with_extension(extension)])
            );
        }
        for source in [
            "nook-web-research/src/App.svelte",
            "nook-web-extension/src/manifest.ts",
        ] {
            assert!(checkout.consumer(source).targets("$app-wasm")?.is_empty());
            assert!(checkout.consumer(source).targets("$lib/nook")?.is_empty());
        }
        let authored = "nook-web-extension/e2e/extension-smoke.spec.ts";
        assert_eq!(
            checkout
                .consumer(authored)
                .targets("$lib/extension/connect")?,
            BTreeSet::from([PathBuf::from(
                "nook-web-shared/src/vault-app/lib/extension/connect.ts"
            )])
        );
        assert!(
            checkout
                .consumer(authored)
                .targets("@playwright/test")?
                .is_empty()
        );
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn projects_cannot_follow_files_or_symlinks_outside_the_checkout() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir()?;
        let checkout = WebWorkspace::at(temp.path())?;
        fs::create_dir_all(&checkout.web)?;
        fs::write(checkout.web.join("main.ts"), "")?;
        let outside = tempfile::tempdir()?;
        let file = outside.path().canonicalize()?.join("other.ts");
        fs::write(&file, "")?;
        symlink(&file, checkout.web.join("linked.ts"))?;
        assert!(
            checkout
                .consumer("main.ts")
                .targets(&file.to_string_lossy())?
                .is_empty()
        );
        assert!(checkout.consumer("main.ts").targets("./linked")?.is_empty());
        Ok(())
    }

    #[test]
    fn installed_generated_exports_share_the_scan_snapshot() -> anyhow::Result<()> {
        let temp = tempfile::tempdir()?;
        let checkout = WebWorkspace::at(temp.path())?;
        let source = checkout.web.join("consumer.ts");
        let artifact = checkout
            .web
            .join(super::super::VAULT_WASM_PATH)
            .with_extension("d.ts");
        fs::create_dir_all(
            artifact
                .parent()
                .ok_or_else(|| anyhow::anyhow!("missing artifact parent"))?,
        )?;
        fs::write(
            &artifact,
            "export declare function generate_secret_id(): string;",
        )?;
        fs::write(&source, "")?;
        let projects = checkout.collect(vec![source.clone()])?;
        fs::remove_file(&artifact)?;
        for project in projects {
            let installed = project
                .inputs
                .module(&artifact)
                .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            assert!(installed.source.contains("generate_secret_id"));
        }
        for project in checkout.collect(vec![source])? {
            assert!(project.inputs.module(&artifact).is_err());
        }
        Ok(())
    }

    #[test]
    fn standalone_projects_ignore_parent_and_sibling_aliases_and_prefer_specific_paths()
    -> anyhow::Result<()> {
        let temp = tempfile::tempdir()?;
        let checkout = WebWorkspace::at(temp.path())?;
        let project = checkout.web.join("project");
        fs::create_dir_all(&project)?;
        fs::write(project.join("main.ts"), "")?;
        fs::write(project.join("correct.ts"), "")?;
        fs::write(project.join("wrong.ts"), "")?;
        fs::write(
            project.join("tsconfig.json"),
            r#"{"compilerOptions":{"paths":{
        "$lib/*":["./wrong.ts"], "$lib/specific/*":["./correct.ts"], "$app-wasm":["./correct.ts"]
    }}}"#,
        )?;
        assert_eq!(
            checkout.consumer("project/main.ts").targets("$app-wasm")?,
            BTreeSet::from([PathBuf::from("project/correct.ts")])
        );
        let sibling = checkout.web.join("sibling");
        fs::create_dir(&sibling)?;
        let unrelated = r#"{"compilerOptions":{"paths":{"$unrelated":["./wrong.ts"]}}}"#;
        for directory in [&sibling, &checkout.web] {
            fs::write(directory.join("tsconfig.json"), unrelated)?;
            fs::write(directory.join("wrong.ts"), "")?;
        }
        assert_eq!(
            checkout
                .consumer("project/main.ts")
                .targets("$lib/specific/name")?,
            BTreeSet::from([PathBuf::from("project/correct.ts")])
        );
        assert!(
            checkout
                .consumer("project/main.ts")
                .targets("$unrelated")?
                .is_empty()
        );
        Ok(())
    }
}
