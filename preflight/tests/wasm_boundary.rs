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
        (
            "reassignment.ts",
            r#"let client = await import("$app-wasm");
client = socketApi;
const openSocket = client.connect;"#,
        ),
        (
            "object-property.ts",
            r#"import * as wasm from "$app-wasm";
const api = { generateSecretId: wasm.generate_secret_id };
api.generateSecretId();"#,
        ),
        (
            "namespace-static.ts",
            r#"import * as wasm from "$app-wasm";
const simpleVault = wasm.NookVaultArchitecture.simple;"#,
        ),
        (
            "facade.ts",
            r#"export { NookVaultArchitecture } from "$app-wasm";
export { NookVaultManager } from "third-party";"#,
        ),
        f("commonjs-bridge.cjs", r#"exports.generate_secret_id = require("nook-wasm").generate_secret_id;"#),
        f("commonjs-consumer.ts", r#"const { generate_secret_id: generateSecretId } = require("./commonjs-bridge.cjs");"#),
        f("commonjs-module-bridge.cjs", r#"module.exports.generate_secret_id = require("nook-wasm").generate_secret_id;"#),
        f("commonjs-module-consumer.ts", r#"const { generate_secret_id: createSecretId } = require("./commonjs-module-bridge.cjs");"#),
        (
            "conditional-reassignment.ts",
            r#"let wasm = await import("$app-wasm");
if (useSocket) wasm = socketApi;
const generateSecretId = wasm.generate_secret_id;"#,
        ),
        (
            "destructuring-instance.ts",
            r#"import { NookVaultManager } from "$app-wasm";
const manager = new NookVaultManager();
const { connect: connectVault } = manager;"#,
        ),
        (
            "destructuring-static.ts",
            r#"import { NookVaultArchitecture } from "$app-wasm";
const { simple: simpleVault } = NookVaultArchitecture;"#,
        ),
        (
            "factory-third-party.ts",
            r#"import { NookVaultManager as SocketManager } from "third-party";
export function makeSocket(): SocketManager { throw new Error(); }"#,
        ),
        (
            "factory-third-party-consumer.ts",
            r#"import { makeSocket } from "./factory-third-party";
const socket = makeSocket();
const openSocket = socket.connect;"#,
        ),
        (
            "member-assignment.ts",
            r#"import * as wasm from "$app-wasm";
const api = {};
api.generateSecretId = wasm.generate_secret_id;"#,
        ),
        (
            "mixed-facade.ts",
            r#"import { NookVaultManager } from "./facade";
const manager = new NookVaultManager();
const openSocket = manager.connect;"#,
        ),
        (
            "namespace-copy.ts",
            r#"const wasm = await import("$app-wasm");
const bridge = wasm;
const generateSecretId = bridge.generate_secret_id;"#,
        ),
        (
            "wrapped-receiver.ts",
            r#"import { NookVaultManager } from "$app-wasm";
const manager = new NookVaultManager();
const connectVault = (manager as NookVaultManager).connect;"#,
        ),
        (
            "instance-copy.ts",
            r#"import { NookVaultManager } from "$app-wasm";
const manager = new NookVaultManager();
const bridge = manager;
const connectVault = bridge.connect;"#,
        ),
        (
            "scoped-dynamic-destructuring.ts",
            r#"{
  const { generate_secret_id } = await import("$app-wasm");
  const generateSecretId = generate_secret_id;
}"#,
        ),
        (
            "namespace-export-bridge.ts",
            r#"export * as wasm from "$app-wasm";
export { connect } from "socket-lib";"#,
        ),
        (
            "namespace-export-consumer.ts",
            r#"import { wasm } from "./namespace-export-bridge";
const generateSecretId = wasm.generate_secret_id;"#,
        ),
        (
            "template-member.ts",
            r#"import * as wasm from "$app-wasm";
const generateSecretId = wasm[`generate_secret_id`];"#,
        ),
        (
            "forward-closure.ts",
            r#"const invoke = () => {
  const generateSecretId = wasm.generate_secret_id;
};
const wasm = await import("$app-wasm");
invoke();"#,
        ),
        f("dynamic-import-callback.ts", r#"import("$app-wasm").then(({ generate_secret_id: generateSecretId }) => generateSecretId());"#),
        (
            "template-const.svelte",
            r#"<script lang="ts">
import * as wasm from "$app-wasm";
</script>
{#if ready}{@const generateSecretId = wasm.generate_secret_id}{generateSecretId()}{/if}"#,
        ),
        (
            "destructuring-assignment.ts",
            r#"let generate_secret_id;
({ generate_secret_id } = await import("$app-wasm"));
const generateSecretId = generate_secret_id;"#,
        ),
        (
            "assigned-factory.ts",
            r#"import { NookVaultManager } from "$app-wasm";
export function getVaultManager(): NookVaultManager { throw new Error(); }"#,
        ),
        (
            "assigned-factory-consumer.ts",
            r#"import { getVaultManager } from "./assigned-factory";
let manager;
manager = await getVaultManager();
const connectVault = manager.connect;"#,
        ),
        (
            "runtime-receiver-false-positive.ts",
            r"const receiver = (window.__nookVault, sdk);
const manager = receiver.requireManager();
const openSocket = manager.connect;",
        ),
        f("escaped-identifier.ts", "import * as wasm from \"$app-wasm\";\nconst generateSecretId = wasm.generate_\\u0073ecret_id;"),
        (
            "scoped-factory-false-positive.ts",
            r#"import { create } from "third-party";
import { NookVaultManager } from "$app-wasm";
function nested() { function create(): NookVaultManager { throw new Error(); } }
const manager = create();
const openSocket = manager.connect;"#,
        ),
        (
            "var-namespace.ts",
            r#"async function load() {
  { var wasm = await import("$app-wasm"); }
  const generateSecretId = wasm.generate_secret_id;
}"#,
        ),
        f("namespace-symbol-false-positive.ts", r#"import { connect as openSocket } from "./namespace-export-bridge";"#),
        (
            "template-event.svelte",
            r#"<script lang="ts">import * as wasm from "$app-wasm";</script>
<button onclick={() => {
  const generateSecretId = wasm.generate_secret_id;
  generateSecretId();
}}>Create</button>"#,
        ),
        (
            "generic-factory-false-positive.ts",
            r#"import { NookVaultManager } from "$app-wasm";
function makeSocket(): SocketEnvelope<NookVaultManager> { throw new Error(); }
const socket = makeSocket();
const openSocket = socket.connect;"#,
        ),
        (
            "callback-namespace.ts",
            r#"import("$app-wasm").then((wasm) => {
  const generateSecretId = wasm.generate_secret_id;
});"#,
        ),
        (
            "class-copy.ts",
            r#"import { NookVaultManager } from "$app-wasm";
const Vault = NookVaultManager;
const manager = new Vault();
const connectVault = manager.connect;"#,
        ),
        (
            "exported-declaration-bridge.ts",
            r#"import * as wasm from "$app-wasm";
export const generate_secret_id = wasm.generate_secret_id;"#,
        ),
        f("exported-declaration-consumer.ts", r#"import { generate_secret_id as generateSecretId } from "./exported-declaration-bridge";"#),
        (
            "method-return.ts",
            r#"import { NookVaultManager } from "$app-wasm";
const manager = new NookVaultManager();
const finish = manager.device_access_snapshot_request().resolve;"#,
        ),
        (
            "svelte-each-shadow.svelte",
            r#"<script lang="ts">import * as wasm from "$app-wasm";</script>
{#each socketApis as wasm}
  {@const openSocket = wasm.connect}
{/each}"#,
        ),
        (
            "outer-assignment.ts",
            r#"let wasm;
async function load() { wasm = await import("$app-wasm"); }
await load();
const generateSecretId = wasm.generate_secret_id;"#,
        ),
        (
            "default-bridge.ts",
            r#"import * as wasm from "$app-wasm";
export default wasm.generate_secret_id;"#,
        ),
        f("default-consumer.ts", r#"import generateSecretId from "./default-bridge";"#),
        f("generated-default-init.ts", r#"import initNookWasm from "$app-wasm";"#),
        (
            "default-identifier-bridge.ts",
            r#"import { generate_secret_id } from "$app-wasm";
export default generate_secret_id;"#,
        ),
        f("default-identifier-consumer.ts", r#"import generateSecretId from "./default-identifier-bridge";"#),
        (
            "conditional-member.ts",
            r#"import * as wasm from "$app-wasm";
const generateSecretId = ready ? wasm.generate_secret_id : fallback;"#,
        ),
        (
            "default-parameter.ts",
            r#"import * as wasm from "$app-wasm";
function run(generateSecretId = wasm.generate_secret_id) { generateSecretId(); }"#,
        ),
        (
            "svelte-destructured-shadow.svelte",
            r#"<script lang="ts">import * as wasm from "$app-wasm";</script>
{#each socketApis as { wasm }}
  {@const openSocket = wasm.connect}
{/each}"#,
        ),
        (
            "typed-parameter.ts",
            r#"import type { NookVaultManager } from "$app-wasm";
function run(manager: NookVaultManager) { const connectVault = manager.connect; }"#,
        ),
        (
            "namespace-factory.ts",
            r#"import * as bridge from "./assigned-factory";
const manager = bridge.getVaultManager();
const connectVault = manager.connect;"#,
        ),
        (
            "commonjs-namespace-bridge.ts",
            r#"const wasm = require("nook-wasm");
exports.generate_secret_id = wasm.generate_secret_id;"#,
        ),
        f("commonjs-namespace-consumer.ts", r#"const { generate_secret_id: generateSecretId } = require("./commonjs-namespace-bridge");"#),
        (
            "switch-shadow.ts",
            r#"import * as wasm from "$app-wasm";
switch (kind) {
  case "socket":
    const wasm = socketApi;
    const openSocket = wasm.connect;
}"#,
        ),
        (
            "unused-deferred-assignment.ts",
            r#"let api = socketApi;
async function load() { api = await import("$app-wasm"); }
const openSocket = api.connect;"#,
        ),
        f("escaped-import.ts", "import { generate_\\u0073ecret_id as generateSecretId } from \"$app-wasm\";"),
        (
            "bound-method.ts",
            r#"import { NookVaultManager } from "$app-wasm";
const manager = new NookVaultManager();
const connectVault = manager.connect.bind(manager);"#,
        ),
        (
            "class-field.ts",
            r#"import * as wasm from "$app-wasm";
class Api { generateSecretId = wasm.generate_secret_id; }"#,
        ),
        f("project/tsconfig.json", r#"{"compilerOptions":{"paths":{"$lib/*":["../shared/*"]}}}"#),
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
        ("escaped-import.ts", 1),
        ("bound-method.ts", 3),
        ("class-field.ts", 2),
        ("project/src/routes/consumer.ts", 1),
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
