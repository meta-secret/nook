use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn wasm_source_does_not_use_js_value() -> anyhow::Result<()> {
    let repository_root = std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    );

    let violations = nook_preflight::wasm_js_values(&repository_root)?;

    assert!(
        violations.is_empty(),
        "JsValue is prohibited in authored nook-wasm Rust; use a typed wasm-bindgen struct or browser API type instead:\n{}",
        violations
            .iter()
            .map(|violation| format!("{}:{}", violation.path.display(), violation.line))
            .collect::<Vec<_>>()
            .join("\n")
    );
    Ok(())
}

#[test]
fn wasm_callable_names_preserve_rust_provenance_end_to_end() -> anyhow::Result<()> {
    let root = wasm_callable_fixture_root();
    create_wasm_callable_fixture(&root)?;

    let violations = nook_preflight::rust_wasm_callable_name_overrides(&root)?;
    let mut locations = violations
        .iter()
        .map(|violation| {
            (
                violation
                    .path
                    .strip_prefix(&root)
                    .unwrap_or(&violation.path)
                    .to_path_buf(),
                violation.line,
            )
        })
        .collect::<Vec<_>>();
    locations.sort();
    assert_eq!(locations, expected_wasm_callable_alias_locations());
    fs::remove_dir_all(root)?;
    Ok(())
}

fn wasm_callable_fixture_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "nook-wasm-callable-provenance-{}",
        std::process::id()
    ))
}

fn create_wasm_callable_fixture(root: &Path) -> anyhow::Result<()> {
    if root.exists() {
        fs::remove_dir_all(root)?;
    }
    let rust_root = root.join("nook-app/nook-platform/nook-wasm/src");
    let web_root = root.join("nook-app/nook-web");
    fs::create_dir_all(&rust_root)?;
    fs::create_dir_all(&web_root)?;
    fs::write(rust_root.join("lib.rs"), wasm_callable_rust_fixture())?;
    for (name, source) in wasm_callable_web_fixtures() {
        write_web_source(&web_root, name, source)?;
    }
    Ok(())
}

fn wasm_callable_rust_fixture() -> &'static str {
    r"use wasm_bindgen::prelude::wasm_bindgen as export_wasm;
#[export_wasm]
pub fn generate_secret_id() {}
#[export_wasm]
pub struct NookVaultArchitecture;
#[export_wasm]
pub struct NookVaultManager;
#[export_wasm]
pub struct NookDeviceAccessSnapshotRequest;
#[export_wasm]
impl NookVaultArchitecture {
    pub fn simple() {}
    pub fn connect() {}
}
#[export_wasm]
impl NookVaultManager {
    pub fn connect() {}
    pub fn device_access_snapshot_request(&self) -> Result<NookDeviceAccessSnapshotRequest, ()> { todo!() }
}
#[export_wasm]
impl NookDeviceAccessSnapshotRequest {
    pub fn resolve() {}
}
"
}

#[allow(clippy::too_many_lines)]
#[rustfmt::skip]
fn wasm_callable_web_fixtures() -> Vec<(&'static str, &'static str)> {
    vec![
        f("aliased-attribute.ts", r#"import { generate_secret_id as generateSecretId } from "$app-wasm";"#),
        f("reassignment.ts", "let client = await import(\"$app-wasm\");\nclient = socketApi;\nconst openSocket = client.connect;"),
        f("object-property.ts", "import * as wasm from \"$app-wasm\";\nconst api = { generateSecretId: wasm.generate_secret_id };\napi.generateSecretId();"),
        f("namespace-static.ts", "import * as wasm from \"$app-wasm\";\nconst simpleVault = wasm.NookVaultArchitecture.simple;"),
        f("facade.ts", "export { NookVaultArchitecture } from \"$app-wasm\";\nexport { NookVaultManager } from \"third-party\";"),
        f("commonjs-bridge.cjs", r#"exports.generate_secret_id = require("nook-wasm").generate_secret_id;"#),
        f("commonjs-consumer.ts", r#"const { generate_secret_id: generateSecretId } = require("./commonjs-bridge.cjs");"#),
        f("commonjs-module-bridge.cjs", r#"module.exports.generate_secret_id = require("nook-wasm").generate_secret_id;"#),
        f("commonjs-module-consumer.ts", r#"const { generate_secret_id: createSecretId } = require("./commonjs-module-bridge.cjs");"#),
        f("conditional-reassignment.ts", "let wasm = await import(\"$app-wasm\");\nif (useSocket) wasm = socketApi;\nconst generateSecretId = wasm.generate_secret_id;"),
        f("destructuring-instance.ts", "import { NookVaultManager } from \"$app-wasm\";\nconst manager = new NookVaultManager();\nconst { connect: connectVault } = manager;"),
        f("destructuring-static.ts", "import { NookVaultArchitecture } from \"$app-wasm\";\nconst { simple: simpleVault } = NookVaultArchitecture;"),
        f("factory-third-party.ts", "import { NookVaultManager as SocketManager } from \"third-party\";\nexport function makeSocket(): SocketManager { throw new Error(); }"),
        f("factory-third-party-consumer.ts", "import { makeSocket } from \"./factory-third-party\";\nconst socket = makeSocket();\nconst openSocket = socket.connect;"),
        f("member-assignment.ts", "import * as wasm from \"$app-wasm\";\nconst api = {};\napi.generateSecretId = wasm.generate_secret_id;"),
        f("mixed-facade.ts", "import { NookVaultManager } from \"./facade\";\nconst manager = new NookVaultManager();\nconst openSocket = manager.connect;"),
        f("namespace-copy.ts", "const wasm = await import(\"$app-wasm\");\nconst bridge = wasm;\nconst generateSecretId = bridge.generate_secret_id;"),
        f("wrapped-receiver.ts", "import { NookVaultManager } from \"$app-wasm\";\nconst manager = new NookVaultManager();\nconst connectVault = (manager as NookVaultManager).connect;"),
        f("instance-copy.ts", "import { NookVaultManager } from \"$app-wasm\";\nconst manager = new NookVaultManager();\nconst bridge = manager;\nconst connectVault = bridge.connect;"),
        f("scoped-dynamic-destructuring.ts", "{\n  const { generate_secret_id } = await import(\"$app-wasm\");\n  const generateSecretId = generate_secret_id;\n}"),
        f("namespace-export-bridge.ts", "export * as wasm from \"$app-wasm\";\nexport { connect } from \"socket-lib\";"),
        f("namespace-export-consumer.ts", "import { wasm } from \"./namespace-export-bridge\";\nconst generateSecretId = wasm.generate_secret_id;"),
        f("template-member.ts", "import * as wasm from \"$app-wasm\";\nconst generateSecretId = wasm[`generate_secret_id`];"),
        f("forward-closure.ts", "const invoke = () => {\n  const generateSecretId = wasm.generate_secret_id;\n};\nconst wasm = await import(\"$app-wasm\");\ninvoke();"),
        f("dynamic-import-callback.ts", r#"import("$app-wasm").then(({ generate_secret_id: generateSecretId }) => generateSecretId());"#),
        f("template-const.svelte", "<script lang=\"ts\">\nimport * as wasm from \"$app-wasm\";\n</script>\n{#if ready}{@const generateSecretId = wasm.generate_secret_id}{generateSecretId()}{/if}"),
        f("destructuring-assignment.ts", "let generate_secret_id;\n({ generate_secret_id } = await import(\"$app-wasm\"));\nconst generateSecretId = generate_secret_id;"),
        f("assigned-factory.ts", "import { NookVaultManager } from \"$app-wasm\";\nexport function getVaultManager(): NookVaultManager { throw new Error(); }"),
        f("assigned-factory-consumer.ts", "import { getVaultManager } from \"./assigned-factory\";\nlet manager;\nmanager = await getVaultManager();\nconst connectVault = manager.connect;"),
        f("runtime-receiver-false-positive.ts", "const receiver = (window.__nookVault, sdk);\nconst manager = receiver.requireManager();\nconst openSocket = manager.connect;"),
        f("escaped-identifier.ts", "import * as wasm from \"$app-wasm\";\nconst generateSecretId = wasm.generate_\\u0073ecret_id;"),
        f("scoped-factory-false-positive.ts", "import { create } from \"third-party\";\nimport { NookVaultManager } from \"$app-wasm\";\nfunction nested() { function create(): NookVaultManager { throw new Error(); } }\nconst manager = create();\nconst openSocket = manager.connect;"),
        f("var-namespace.ts", "async function load() {\n  { var wasm = await import(\"$app-wasm\"); }\n  const generateSecretId = wasm.generate_secret_id;\n}"),
        f("namespace-symbol-false-positive.ts", r#"import { connect as openSocket } from "./namespace-export-bridge";"#),
        f("template-event.svelte", "<script lang=\"ts\">import * as wasm from \"$app-wasm\";</script>\n<button onclick={() => {\n  const generateSecretId = wasm.generate_secret_id;\n  generateSecretId();\n}}>Create</button>"),
        f("generic-factory-false-positive.ts", "import { NookVaultManager } from \"$app-wasm\";\nfunction makeSocket(): SocketEnvelope<NookVaultManager> { throw new Error(); }\nconst socket = makeSocket();\nconst openSocket = socket.connect;"),
        f("callback-namespace.ts", "import(\"$app-wasm\").then((wasm) => {\n  const generateSecretId = wasm.generate_secret_id;\n});"),
        f("class-copy.ts", "import { NookVaultManager } from \"$app-wasm\";\nconst Vault = NookVaultManager;\nconst manager = new Vault();\nconst connectVault = manager.connect;"),
        f("exported-declaration-bridge.ts", "import * as wasm from \"$app-wasm\";\nexport const generate_secret_id = wasm.generate_secret_id;"),
        f("exported-declaration-consumer.ts", r#"import { generate_secret_id as generateSecretId } from "./exported-declaration-bridge";"#),
        f("method-return.ts", "import { NookVaultManager } from \"$app-wasm\";\nconst manager = new NookVaultManager();\nconst finish = manager.device_access_snapshot_request().resolve;"),
        f("svelte-each-shadow.svelte", "<script lang=\"ts\">import * as wasm from \"$app-wasm\";</script>\n{#each socketApis as wasm}\n  {@const openSocket = wasm.connect}\n{/each}"),
        f("outer-assignment.ts", "let wasm;\nasync function load() { wasm = await import(\"$app-wasm\"); }\nawait load();\nconst generateSecretId = wasm.generate_secret_id;"),
        f("default-bridge.ts", "import * as wasm from \"$app-wasm\";\nexport default wasm.generate_secret_id;"),
        f("default-consumer.ts", r#"import generateSecretId from "./default-bridge";"#),
        f("generated-default-init.ts", r#"import initNookWasm from "$app-wasm";"#),
        f("default-identifier-bridge.ts", "import { generate_secret_id } from \"$app-wasm\";\nexport default generate_secret_id;"),
        f("default-identifier-consumer.ts", r#"import generateSecretId from "./default-identifier-bridge";"#),
        f("conditional-member.ts", "import * as wasm from \"$app-wasm\";\nconst generateSecretId = ready ? wasm.generate_secret_id : fallback;"),
        f("default-parameter.ts", "import * as wasm from \"$app-wasm\";\nfunction run(generateSecretId = wasm.generate_secret_id) { generateSecretId(); }"),
        f("svelte-destructured-shadow.svelte", "<script lang=\"ts\">import * as wasm from \"$app-wasm\";</script>\n{#each socketApis as { wasm }}\n  {@const openSocket = wasm.connect}\n{/each}"),
        f("typed-parameter.ts", "import type { NookVaultManager } from \"$app-wasm\";\nfunction run(manager: NookVaultManager) { const connectVault = manager.connect; }"),
        f("namespace-factory.ts", "import * as bridge from \"./assigned-factory\";\nconst manager = bridge.getVaultManager();\nconst connectVault = manager.connect;"),
        f("commonjs-namespace-bridge.ts", "const wasm = require(\"nook-wasm\");\nexports.generate_secret_id = wasm.generate_secret_id;"),
        f("commonjs-namespace-consumer.ts", r#"const { generate_secret_id: generateSecretId } = require("./commonjs-namespace-bridge");"#),
        f("switch-shadow.ts", "import * as wasm from \"$app-wasm\";\nswitch (kind) {\n  case \"socket\":\n    const wasm = socketApi;\n    const openSocket = wasm.connect;\n}"),
        f("unused-deferred-assignment.ts", "let api = socketApi;\nasync function load() { api = await import(\"$app-wasm\"); }\nconst openSocket = api.connect;"),
        f("escaped-import.ts", "import { generate_\\u0073ecret_id as generateSecretId } from \"$app-wasm\";"),
        f("bound-method.ts", "import { NookVaultManager } from \"$app-wasm\";\nconst manager = new NookVaultManager();\nconst connectVault = manager.connect.bind(manager);"),
        f("class-field.ts", "import * as wasm from \"$app-wasm\";\nclass Api { generateSecretId = wasm.generate_secret_id; }"),
        f("project/tsconfig.json", r#"{"compilerOptions":{"paths":{"$lib/*":["../shared/*"],"$vault-shared/*":["../shared/*"],"$web-shared/*":["../shared/*"]}}}"#),
        f("shared/wasm-bridge.ts", r#"export { generate_secret_id } from "$app-wasm";"#),
        f("project/src/routes/consumer.ts", r#"import { generate_secret_id as generateSecretId } from "$lib/wasm-bridge";"#),
        f("escaped-facade.ts", "export { generate_\\u0073ecret_id } from \"$app-wasm\";"),
        f("escaped-facade-consumer.ts", r#"import { generate_secret_id as generateSecretId } from "./escaped-facade";"#),
        f("multi-declarator-bridge.ts", r#"import * as wasm from "$app-wasm"; export const marker = 0, generate_secret_id = wasm.generate_secret_id;"#),
        f("multi-declarator-consumer.ts", r#"import { generate_secret_id as generateSecretId } from "./multi-declarator-bridge";"#),
        f("direct-object-argument.ts", r#"import * as wasm from "$app-wasm"; register({ generateSecretId: wasm.generate_secret_id });"#),
        f("default-factory.ts", r#"import { NookVaultManager } from "$app-wasm"; export default function getManager(): NookVaultManager { throw new Error(); }"#),
        f("default-factory-consumer.ts", r#"import getManager from "./default-factory"; const manager = getManager(); const connectVault = manager.connect;"#),
        f("svelte-script-scope.svelte", r#"<script module lang="ts">import * as wasm from "$app-wasm";</script><script lang="ts">const wasm = socketApi; const openSocket = wasm.connect;</script>"#),
        f("shadowed-export-bridge.ts", r#"export * from "$app-wasm"; export { connect } from "socket-lib";"#),
        f("shadowed-export-consumer.ts", r#"import { connect as openSocket } from "./shadowed-export-bridge";"#),
        f("reassigned-callable.ts", "let { generate_secret_id } = await import(\"$app-wasm\");\ngenerate_secret_id = socketApi.connect;\nconst openSocket = generate_secret_id;"),
        f("scoped-namespace-constructor.ts", "const wasm = await import(\"$app-wasm\");\nconst manager = new wasm.NookVaultManager();\nconst connectVault = manager.connect;"),
        f("block-local-callable.ts", "import * as wasm from \"$app-wasm\";\nfunction run() {\nconst generate_secret_id = wasm.generate_secret_id;\nconst generateSecretId = generate_secret_id;\n}"),
        f("commonjs-object-bridge.ts", r#"const wasm = require("nook-wasm"); module.exports = { generate_secret_id: wasm.generate_secret_id };"#),
        f("commonjs-object-consumer.ts", r#"const { generate_secret_id: generateSecretId } = require("./commonjs-object-bridge");"#),
        f("method-parameter-scope.ts", r#"import type { NookVaultManager } from "$app-wasm"; class Api { run(manager: NookVaultManager) { manager.connect(); } } const manager = socketApi; const openSocket = manager.connect;"#),
        f("array-destructuring.ts", r#"import * as wasm from "$app-wasm"; const [generateSecretId] = [wasm.generate_secret_id];"#),
        f("svelte-renamed-pattern.svelte", r#"<script lang="ts">import * as wasm from "$app-wasm";</script>{#each items as { wasm: socket }}{@const generateSecretId = wasm.generate_secret_id}{/each}"#),
        f("namespace-type-parameter.ts", r#"import type * as wasm from "$app-wasm"; function run(manager: wasm.NookVaultManager) { const connectVault = manager.connect; }"#),
        f("identifier-default-factory.ts", r#"import { NookVaultManager } from "$app-wasm"; const getManager = (): NookVaultManager => { throw new Error(); }; export default getManager;"#),
        f("identifier-default-factory-consumer.ts", r#"import getManager from "./identifier-default-factory"; const manager = getManager(); const connectVault = manager.connect;"#),
        f("nested-var-shadow.ts", r#"import * as wasm from "$app-wasm"; function run() { { var wasm = socketApi; } const openSocket = wasm.connect; }"#),
        f("project/src/routes/vault-alias-consumer.ts", r#"import { generate_secret_id as generateSecretId } from "$vault-shared/wasm-bridge";"#),
        f("sparse-array-destructuring.ts", r#"import * as wasm from "$app-wasm"; const [, generateSecretId] = [fallback, wasm.generate_secret_id];"#),
        f("late-deferred-call.ts", r#"let api = socketApi; async function load() { api = await import("$app-wasm"); } const openSocket = api.connect; load();"#),
        f("commonjs-callable-bridge.cjs", r#"module.exports = require("nook-wasm").generate_secret_id;"#),
        f("commonjs-callable-consumer.cjs", r#"const generateSecretId = require("./commonjs-callable-bridge.cjs");"#),
        f("direct-constructor.ts", r#"import { NookVaultManager } from "$app-wasm"; const connectVault = new NookVaultManager().connect;"#),
        f("default-object-pattern.ts", r#"const { generate_secret_id = fallback } = await import("$app-wasm"); const generateSecretId = generate_secret_id;"#),
        f("escaped-local-reexport.ts", r#"import { generate_secret_id } from "$app-wasm"; export { generate_\u0073ecret_id as generateSecretId };"#),
        f("property-instance.ts", r#"import { NookVaultManager } from "$app-wasm"; class Api { configure() { this.manager = new NookVaultManager(); const connectVault = this.manager.connect; } }"#),
    ]
}

const fn f(name: &'static str, source: &'static str) -> (&'static str, &'static str) {
    (name, source)
}

fn expected_wasm_callable_alias_locations() -> Vec<(PathBuf, usize)> {
    let mut locations = [
        ("aliased-attribute.ts", 1),
        ("commonjs-consumer.ts", 1),
        ("commonjs-module-consumer.ts", 1),
        ("conditional-reassignment.ts", 3),
        ("destructuring-instance.ts", 3),
        ("destructuring-static.ts", 2),
        ("member-assignment.ts", 3),
        ("namespace-copy.ts", 3),
        ("namespace-static.ts", 2),
        ("object-property.ts", 2),
        ("wrapped-receiver.ts", 3),
        ("instance-copy.ts", 4),
        ("scoped-dynamic-destructuring.ts", 3),
        ("namespace-export-consumer.ts", 2),
        ("template-member.ts", 2),
        ("forward-closure.ts", 2),
        ("dynamic-import-callback.ts", 1),
        ("template-const.svelte", 4),
        ("destructuring-assignment.ts", 3),
        ("assigned-factory-consumer.ts", 4),
        ("escaped-identifier.ts", 2),
        ("var-namespace.ts", 3),
        ("template-event.svelte", 3),
        ("callback-namespace.ts", 2),
        ("class-copy.ts", 4),
        ("exported-declaration-consumer.ts", 1),
        ("method-return.ts", 3),
        ("outer-assignment.ts", 4),
        ("default-consumer.ts", 1),
        ("default-identifier-consumer.ts", 1),
        ("conditional-member.ts", 2),
        ("default-parameter.ts", 2),
        ("typed-parameter.ts", 2),
        ("namespace-factory.ts", 3),
        ("commonjs-namespace-consumer.ts", 1),
        ("escaped-facade-consumer.ts", 1),
        ("multi-declarator-consumer.ts", 1),
        ("direct-object-argument.ts", 1),
        ("default-factory-consumer.ts", 1),
        ("scoped-namespace-constructor.ts", 3),
        ("block-local-callable.ts", 4),
        ("commonjs-object-consumer.ts", 1),
        ("array-destructuring.ts", 1),
        ("escaped-import.ts", 1),
        ("bound-method.ts", 3),
        ("class-field.ts", 2),
        ("project/src/routes/consumer.ts", 1),
        ("namespace-type-parameter.ts", 1),
        ("identifier-default-factory-consumer.ts", 1),
        ("project/src/routes/vault-alias-consumer.ts", 1),
        ("sparse-array-destructuring.ts", 1),
        ("commonjs-callable-consumer.cjs", 1),
        ("commonjs-callable-bridge.cjs", 1),
        ("direct-constructor.ts", 1),
        ("default-object-pattern.ts", 1),
        ("escaped-local-reexport.ts", 1),
        ("property-instance.ts", 1),
        ("svelte-renamed-pattern.svelte", 1),
    ]
    .into_iter()
    .map(|(name, line)| (Path::new("nook-app/nook-web").join(name), line))
    .collect::<Vec<_>>();
    locations.sort();
    locations
}

fn write_web_source(root: &Path, name: &str, source: &str) -> anyhow::Result<()> {
    let path = root.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, source)?;
    Ok(())
}
