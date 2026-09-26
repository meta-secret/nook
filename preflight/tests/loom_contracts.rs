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

    fn task_body<'a>(&self, taskfile: &'a str, task: &str, next_task: &str) -> &'a str {
        let start_marker = format!("  {task}:\n");
        let end_marker = format!("  {next_task}:\n");
        let start = taskfile
            .find(&start_marker)
            .unwrap_or_else(|| panic!("missing task {task}"));
        let body = taskfile
            .get(start..)
            .unwrap_or_else(|| panic!("task {task} begins outside a UTF-8 boundary"));
        let end = body
            .find(&end_marker)
            .unwrap_or_else(|| panic!("missing following task {next_task}"));
        body.get(..end)
            .unwrap_or_else(|| panic!("task {task} ends outside a UTF-8 boundary"))
    }
}

struct LoomPrPolicyScenario {
    root: RepositoryFixture,
}

impl LoomPrPolicyScenario {
    fn repository() -> Self {
        Self {
            root: RepositoryFixture::repository_root(),
        }
    }

    fn task_body<'a>(&self, taskfile: &'a str, task: &str, next_task: &str) -> &'a str {
        let start_marker = format!("  {task}:\n");
        let end_marker = format!("  {next_task}:\n");
        let start = taskfile
            .find(&start_marker)
            .unwrap_or_else(|| panic!("missing task {task}"));
        let body = taskfile
            .get(start..)
            .unwrap_or_else(|| panic!("task {task} begins outside a UTF-8 boundary"));
        let end = body
            .find(&end_marker)
            .unwrap_or_else(|| panic!("missing following task {next_task}"));
        body.get(..end)
            .unwrap_or_else(|| panic!("task {task} ends outside a UTF-8 boundary"))
    }

    fn assert_policy_only_pr_route(&self) {
        let pr_tasks = self.root.read("nook-app/ci/pr.yml");
        let policy_only = self.task_body(
            &pr_tasks,
            "ci:pr:tests:policy-with-delivery-helpers",
            "ci:pr:delivery-helpers",
        );
        assert!(
            policy_only.contains("task --parallel ci:pr:tests:policy ci:pr:delivery-helpers")
                && self
                    .task_body(
                        &pr_tasks,
                        "ci:pr:tests:policy",
                        "ci:pr:tests:policy-with-delivery-helpers",
                    )
                    .contains(
                        "task --taskfile \"{{.REPO_ROOT}}/Taskfile.yml\" preflight:repository-policy",
                    ),
            "policy-only PR workflow must delegate to the named policy task"
        );
    }
}

#[test]
fn loom_verify_enforces_loom_typescript_eslint_rules() {
    let root = RepositoryFixture::repository_root();
    let manifest = root.read("agentic-ai/loom/package.json");
    for required in [
        "\"lint\": \"eslint .\"",
        "\"check\": \"tsc --noEmit\"",
        "\"verify\": \"bun run format:check && bun run lint && bun run check && bun test\"",
        "\"eslint\":",
    ] {
        assert!(
            manifest.contains(required),
            "Loom package.json must retain `{required}`"
        );
    }

    let eslint = root.read("agentic-ai/loom/eslint.config.js");
    for required in [
        "'max-params': ['error', { max: 1 }]",
        "'@typescript-eslint/no-restricted-types'",
        "unknown:",
        "object:",
        "Object:",
        "'{}':",
        "'@typescript-eslint/no-explicit-any': 'error'",
        "'@typescript-eslint/no-empty-object-type': 'error'",
        "files: ['**/*.{ts,js,mjs,cjs}']",
        "Model a concrete domain type",
        "generic object type",
        "must be narrowed immediately",
        "ExternalValue",
        "ExternalObject",
        "JsonValue",
        "GenericValue",
    ] {
        assert!(
            eslint.contains(required),
            "Loom ESLint config must retain `{required}`"
        );
    }

    let guards = root.read("agentic-ai/loom/src/lib/guards.ts");
    for required in [
        "export type UntrustedYamlNode =",
        "export type UntrustedYamlMap =",
        "export type UntrustedYamlMapBuilder =",
        "export class UntrustedYamlBoundary",
        "static fromHost",
        "static property",
        "export enum UntrustedYamlPropertyPresence",
    ] {
        assert!(
            guards.contains(required),
            "Loom guards must retain `{required}`"
        );
    }
    assert!(
        !guards.contains("UnknownRecord"),
        "Loom guards must not keep UnknownRecord after the UntrustedYamlMap rename"
    );
    assert!(
        !guards.contains("ExternalValue") && !guards.contains("ExternalObject"),
        "Loom must not restore generic external value aliases"
    );

    let taskfile = root.read(".task/agentic-ai.yml");
    for required in ["loom:lint:", "bun run lint", "task: loom:lint"] {
        assert!(
            taskfile.contains(required),
            "Loom Taskfile wiring must retain `{required}`"
        );
    }

    let skills_install = root.task_body(&taskfile, "skills:install", "skills:format");
    assert!(
        skills_install.contains("package-gate-cli.ts\" install")
            && skills_install.contains("{{.REPO_ROOT}}"),
        "executable applications must install their pinned workspace"
    );
    let skills_workspace = root.read(".cortex/package.json");
    for required in [
        "@nook/executable-skills-workspace",
        "gizmo-prime/dynamic-skills/*/scripts",
        "shared/dynamic-skills/*/scripts",
        "teams/*/dynamic-skills/*/scripts",
    ] {
        assert!(
            skills_workspace.contains(required),
            "executable-skill workspace must retain `{required}`"
        );
    }
    let skills_bunfig = root.read(".cortex/bunfig.toml");
    assert!(
        skills_bunfig.contains("linker = \"hoisted\""),
        "executable-skill workspace must retain one hoisted dependency tree"
    );
    let skills_verify = root.task_body(&taskfile, "skills:verify", "loom:install");
    assert!(
        skills_verify.contains("deps: [skills:install]")
            && skills_verify.contains("package-gate-cli.ts\" verify"),
        "skills:verify must run every complete workspace package gate"
    );

    let loom_install = root.task_body(&taskfile, "loom:install", "loom:format");
    assert!(
        loom_install.contains("bun install --frozen-lockfile")
            && !loom_install.contains("skills:install"),
        "loom:install must install only Loom dependencies"
    );
    let loom_verify = root.task_body(&taskfile, "loom:verify", "loom:run");
    assert!(
        loom_verify.contains("task: skills:verify") && loom_verify.contains("task: loom:test"),
        "loom:verify must include executable applications and Loom"
    );
    let pre_push = root.task_body(&taskfile, "loom:pre-push", "loom:cortex-audit");
    assert!(
        pre_push.contains("deps: [loom:install, tooling:install]")
            && pre_push.contains("task loom:default FAMILY=prePush")
            && !pre_push.contains("skills:"),
        "loom:pre-push must retain Loom setup without a harness skill workspace"
    );

    let preflight = root.read("preflight/Taskfile.yml");
    let format_contract = root.task_body(
        &preflight,
        "preflight:format-contract",
        "preflight:dependency-policy",
    );
    assert!(
        format_contract
            .contains("bun test \"{{.REPO_ROOT}}/infra/contracts/dockerized-rust.test.ts\"")
            && !format_contract.contains("deps:")
            && !format_contract.contains("install")
            && !format_contract.contains("loom:"),
        "the formatter contract must be a detached, install-free preflight task"
    );

    let skills_manifest =
        root.read(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/package.json");
    assert!(
        skills_manifest.contains("\"verify\":")
            && skills_manifest.contains("\"zod\":")
            && skills_manifest.contains("\"neverthrow\":")
    );
    let skills_eslint = root
        .read(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/eslint.config.js");
    assert!(
        skills_eslint.contains("files: ['**/*.{ts,js,mjs,cjs}']")
            && skills_eslint.contains("'max-params': ['error', { max: 1 }]")
            && skills_eslint.contains("unknown:"),
        "executable applications must retain repository TypeScript rules"
    );
    let skills_typescript =
        root.read(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/tsconfig.json");
    assert!(skills_typescript
        .contains("\"include\": [\"**/*.ts\", \"**/*.js\", \"**/*.mjs\", \"**/*.cjs\"]"));
    let source_gate = root.read("agentic-ai/loom/tests/skill-application-source-boundary.test.ts");
    assert!(
        source_gate.contains("ExecutableSkillSource.analyze")
            && source_gate
                .contains(".cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts")
            && source_gate.contains("new ExecutableSkillCheckout(")
            && source_gate.contains(").readTrackedFiles()"),
        "loom:verify must AST-audit every tracked executable application source"
    );
    let tracked_inventory = root.read("agentic-ai/loom/src/executable-skills/repository.ts");
    assert!(
        tracked_inventory.contains("['ls-files', '--stage', '-z']")
            && tracked_inventory.contains("readTrackedFiles(): Result<"),
        "executable application gates must share the NUL-safe staged inventory"
    );
}

#[test]
fn loom_workflow_audits_every_cortex_change() {
    let root = RepositoryFixture::repository_root();
    let entrypoint = root.read(".github/workflows/ci.yml");
    let workflow = root.read(".github/workflows/repository-policy.yml");
    let pr_workflow = root.read(".github/workflows/pr.yml");
    let taskfile = root.read(".task/ci-workflows.yml");
    assert!(
        entrypoint.contains("pull_request:")
            && entrypoint.contains("push:")
            && entrypoint.contains("branches: [main]")
            && !entrypoint.contains("paths:")
            && !entrypoint.contains("paths-ignore:")
            && entrypoint.contains(
                "  policy:\n    name: Repository policy\n    if: github.event_name == 'push'\n    needs: scope\n    uses: ./.github/workflows/repository-policy.yml\n    secrets: inherit",
            )
            && entrypoint.contains("    uses: ./.github/workflows/pr.yml")
            && pr_workflow.contains("run: task --silent ci:pr:validate\n")
            && pr_workflow.contains(
                "run: task --silent ci:pr:tests:policy-with-delivery-helpers\n",
            )
            && workflow.contains("workflow_call:"),
        "repository policy must validate every PR and Main tree"
    );
    LoomPrPolicyScenario::repository().assert_policy_only_pr_route();
    assert!(
        workflow.contains("fetch-depth: 0")
            && !workflow.contains("BASELINE_SHA")
            && !workflow.contains("BEFORE_SHA")
            && !workflow.contains("git diff")
            && !workflow.contains("policy-paths")
            && !workflow.contains("cortex_markdown_only"),
        "repository policy must fetch identifier history without inline base comparison or path classification"
    );
    assert!(
        !workflow.contains("arc-manifest-contract.ts")
            && !workflow.contains("runner_placement")
            && !workflow.contains("run: |")
            && !workflow.contains("run: bun ")
            && !workflow.contains("run: bash "),
        "repository policy must contain only Actions setup glue and thin Task invocations"
    );
    assert!(
        taskfile.contains("task: preflight:repository-policy"),
        "both trust domains must use the Docker policy Task surface"
    );
    let dockerfile = root.read("preflight/Dockerfile");
    for task in [
        "task loom:verify",
        "task preflight:format-contract",
        "task loom:cortex-audit",
    ] {
        assert!(
            dockerfile.contains(task),
            "Docker policy must retain `{task}`"
        );
    }
    assert!(
        workflow.contains("run: task ci:repository-policy:trusted")
            && workflow.contains("run: task ci:repository-policy:untrusted"),
        "trusted and untrusted workflow branches must delegate policy behavior to Taskfile"
    );
}

#[test]
fn meta_cortex_integration_documents_host_native_execution_and_storage_contracts() {
    let integration =
        RepositoryFixture::repository_root().read(".cortex/meta-cortex-integration.md");
    for required in [
        "Execution speed is selected by host-native settings",
        "each role's configured model",
        "and `reasoning_effort`",
        "no `mode` or `service_tier` fields",
        "storage version 3",
        "storage version 1 and 2 feature databases are imported transactionally and only once",
        "Legacy databases and their sidecars are preserved as backups.",
    ] {
        assert!(
            integration.contains(required),
            "Meta-Cortex integration contract must document `{required}`"
        );
    }
}

#[test]
fn preflight_initializes_released_meta_cortex_with_only_default_tool_policies() {
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
    let mise_download_position = dockerfile
        .find("--output /tmp/mise \"$mise_asset_url\"")
        .expect("Docker preflight must download the pinned mise release asset");
    let mise_verification_position = dockerfile
        .find("sha256sum --check -")
        .expect("Docker preflight must verify mise against its fixed SHA-256");
    let mise_install_directory = "install -d -m 0755 /root/.meta-cortex/mise/bin";
    let mise_install_directory_position = dockerfile
        .find(mise_install_directory)
        .expect("Docker preflight must create Meta-Cortex's mise directory");
    let mise_install_path = "install -m 0755 /tmp/mise /root/.meta-cortex/mise/bin/mise";
    let mise_install_position = dockerfile
        .find(mise_install_path)
        .expect("Docker preflight must install mise executable at Meta-Cortex's expected path");
    let bun_image_pin = "registry.dev.nokey.sh/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4";
    let vale_asset_pin = "https://github.com/vale-cli/vale/releases/download/v3.19.0/vale_3.19.0_Linux_64-bit.tar.gz";
    let vale_sha256 = "c8f9d6c8055442bc7e9c121b2498e6f0e3fb670f4665e6ee577f1897f7665cf6";
    assert!(
        dockerfile.contains(bun_image_pin),
        "Docker preflight must stage Bun from the pinned 1.3.14 image"
    );
    assert!(
        dockerfile.contains(vale_asset_pin)
            && dockerfile.contains(&format!("{vale_sha256}  /tmp/vale.tar.gz")),
        "Docker preflight must stage Vale from its pinned, checksum-verified 3.19.0 release"
    );
    let bun_install_directory =
        "install -d -m 0755 /root/.meta-cortex/bun/bin /root/.meta-cortex/vale/bin";
    let bun_install_directory_position = dockerfile
        .find(bun_install_directory)
        .expect("Docker preflight must create Meta-Cortex Bun and Vale directories");
    let bun_install_path = "install -m 0755 /usr/local/bin/bun /root/.meta-cortex/bun/bin/bun";
    let bun_install_position = dockerfile.find(bun_install_path).expect(
        "Docker preflight must stage the pinned Bun executable at Meta-Cortex's expected path",
    );
    let vale_install_path = "install -m 0755 /usr/local/bin/vale /root/.meta-cortex/vale/bin/vale";
    let vale_install_position = dockerfile.find(vale_install_path).expect(
        "Docker preflight must stage the pinned Vale executable at Meta-Cortex's expected path",
    );
    let initialize_request_prefix = concat!(
        "meta-cortex run --request - <<'YAML'\n",
        "version: 1\n",
        "project: /meta-secret/nook\n",
        "operation:\n",
        "  group: Framework\n",
        "  command:\n",
        "    name: Initialize\n",
        "    arguments:\n",
        "      harness: codex\n",
        "      instructions: skip\n"
    );
    let initialize_request_body = dockerfile
        .split_once(initialize_request_prefix)
        .and_then(|(_, remainder)| remainder.split_once("\nYAML"))
        .map(|(request_body, _)| request_body)
        .expect(
            "Docker Framework Initialize request must use the selected harness and instructions",
        );
    let configured_tool_policies = initialize_request_body
        .lines()
        .map(str::trim)
        .collect::<Vec<_>>();
    assert_eq!(
        configured_tool_policies,
        [
            "mise: InstallMissing",
            "bun: InstallMissing",
            "vale: InstallMissing",
        ],
        "Docker Initialize may spell out only the framework's default tool policies"
    );
    let info_request = concat!(
        "meta-cortex run --request - <<'YAML'\n",
        "version: 1\n",
        "project: /meta-secret/nook\n",
        "operation:\n",
        "  group: Framework\n",
        "  command:\n",
        "    name: Info\n",
        "    arguments: {}\n",
        "YAML"
    );
    let git_metadata_copy = dockerfile
        .find("COPY --from=repository-git /git /meta-secret/nook/.git")
        .expect("policy source must copy Git metadata into the project");
    let initialize_position = dockerfile
        .find(initialize_request_prefix)
        .expect("Docker policy source must include its Framework Initialize request");
    assert!(
        mise_download_position < mise_verification_position
            && mise_verification_position < mise_install_directory_position
            && mise_install_directory_position < mise_install_position
            && mise_install_position < bun_install_directory_position
            && bun_install_directory_position < bun_install_position
            && bun_install_position < vale_install_position
            && vale_install_position < initialize_position,
        "Docker preflight must install pinned mise, stage pinned Bun and Vale, then run Framework Initialize"
    );
    assert!(
        git_metadata_copy < initialize_position,
        "policy source must copy Git metadata before Meta-Cortex Framework Initialize"
    );
    assert!(
        dockerfile.contains("meta-cortex/releases/download/v0.9.1/meta-cortex-installer.sh"),
        "Meta-Cortex installation must use the selected upstream release"
    );
    assert!(
        dockerfile.contains(
            "META_CORTEX_UNMANAGED_INSTALL=/usr/local/bin sh /tmp/meta-cortex-installer.sh"
        ) && dockerfile.contains(info_request)
            && !dockerfile.contains("meta-cortex init ")
            && !dockerfile.contains("meta-cortex info "),
        "Meta-Cortex installation must use the supported framework YAML requests"
    );
    assert!(
        !dockerfile.contains("sed -i"),
        "Meta-Cortex installation must not rewrite upstream configuration"
    );
}
