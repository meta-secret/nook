use std::fs;
use std::path::PathBuf;

use nook_preflight::{
    portable_core_browser_dependencies, rust_wasm_domain_boundary_escape_hatches,
    typescript_domain_boundary_boilerplate, typescript_generic_optional_state,
    typescript_implicit_application_state, typescript_json_round_trip_clones,
    typescript_mutable_void_state, typescript_null_absence_sentinels,
    typescript_svelte_state_modeling_violations,
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

#[test]
fn event_log_crate_keeps_the_portable_dependency_direction() {
    let root = repository_root();
    let event_log = fs::read_to_string(root.join("nook-app/nook-event-log/Cargo.toml"))
        .expect("read nook-event-log manifest");
    assert!(event_log.contains("nook-auth2 ="));
    assert!(event_log.contains("nook-replication ="));
    for forbidden in ["nook-core =", "nook-wasm =", "web-sys =", "js-sys ="] {
        assert!(
            !event_log.contains(forbidden),
            "nook-event-log must not depend on {forbidden}"
        );
    }

    let core = fs::read_to_string(root.join("nook-app/nook-core/Cargo.toml"))
        .expect("read nook-core manifest");
    assert!(core.contains("nook-event-log ="));
    assert!(
        !core.contains("nook-replication ="),
        "nook-core must consume replication through the event-log domain"
    );
}

#[test]
fn portable_core_does_not_import_browser_runtime_crates() {
    let violations = portable_core_browser_dependencies(&repository_root())
        .expect("scan portable core dependencies");
    assert!(
        violations.is_empty(),
        "portable Rust crates must stay browser-independent: {violations:#?}"
    );
}

#[test]
fn typescript_domain_boundary_stays_generated_and_direct() {
    let violations = typescript_domain_boundary_boilerplate(&repository_root())
        .expect("scan TypeScript domain boundary");
    assert!(
        violations.is_empty(),
        "vault domain schemas belong in Rust; use generated WASM types and direct exports instead of TypeScript mirrors or forwarding wrappers: {violations:#?}"
    );
}

#[test]
fn typescript_does_not_clone_through_json_serialization() {
    let violations = typescript_json_round_trip_clones(&repository_root())
        .expect("scan TypeScript JSON round-trip clones");
    assert!(
        violations.is_empty(),
        "authored TypeScript and Svelte must use direct values or $state.snapshot at reactive boundaries, never JSON parse/stringify cloning: {violations:#?}"
    );
}

#[test]
fn typescript_uses_undefined_only_at_structural_boundaries() {
    let violations =
        typescript_null_absence_sentinels(&repository_root()).expect("scan TypeScript null usage");
    assert!(
        violations.is_empty(),
        "authored TypeScript and Svelte must keep null at explicit platform boundaries and use undefined only for truthful structural absence: {violations:#?}"
    );
}

#[test]
fn typescript_svelte_state_keeps_domain_ids_precise() {
    let violations = typescript_svelte_state_modeling_violations(&repository_root())
        .expect("scan Svelte state modeling");
    assert!(
        violations.is_empty(),
        "redundant optional expressions are forbidden, Rust-owned identifiers must stay typed, and domain state unions must be Rust/WASM enums: {violations:#?}"
    );
}

#[test]
fn authored_javascript_typescript_and_svelte_never_use_undefined() {
    let violations =
        typescript_implicit_application_state(&repository_root()).expect("scan TypeScript state");
    assert!(
        violations.is_empty(),
        "authored JavaScript, TypeScript, and Svelte must use explicit state and boundary adapters instead of undefined: {violations:#?}"
    );
}

#[test]
fn mutable_typescript_state_never_hides_absence_behind_void() {
    let violations =
        typescript_mutable_void_state(&repository_root()).expect("scan mutable TypeScript state");
    assert!(
        violations.is_empty(),
        "mutable TypeScript and Svelte storage must use an explicit state union, never T | void or $state<T | void>: {violations:#?}"
    );
}

#[test]
fn typescript_state_names_explain_the_domain_transition() {
    let violations = typescript_generic_optional_state(&repository_root())
        .expect("scan generic TypeScript optional state");
    assert!(
        violations.is_empty(),
        "generic Option-style wrappers are forbidden; use domain-specific union names and variants: {violations:#?}"
    );
}

#[test]
fn rust_wasm_domain_boundary_stays_real_and_typed() {
    let violations = rust_wasm_domain_boundary_escape_hatches(&repository_root())
        .expect("scan Rust WASM domain boundary");
    assert!(
        violations.is_empty(),
        "WASM domain DTOs must use real Rust ABI types; unchecked TypeScript hints and raw provider/auth JsValue signatures are forbidden: {violations:#?}"
    );
}

#[test]
fn remote_vault_recovery_requires_core_confirmed_connect_state() {
    let source = fs::read_to_string(
        repository_root()
            .join("nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/secrets.ts"),
    )
    .expect("read vault connection lifecycle");
    assert!(
        source.contains("remoteRecoveryConnectConfirmed("),
        "loadDb must ask Rust policy whether remote recovery was explicitly confirmed"
    );
    assert!(
        !source.contains("remoteVaultRecoveryState === RemoteVaultRecoveryState.None &&"),
        "prompt states must never bypass remote-vault assessment and enter connect"
    );
}
