use std::fs;
use std::path::PathBuf;

use nook_preflight::{
    authored_rust_macro_definitions, portable_core_browser_dependencies,
    rust_test_untyped_json_assertions, rust_tsify_implicit_absence_overrides,
    rust_wasm_domain_boundary_escape_hatches, typescript_domain_boundary_boilerplate,
    typescript_generic_optional_state, typescript_implicit_application_state,
    typescript_json_round_trip_clones, typescript_mutable_void_state,
    typescript_null_absence_sentinels, typescript_raw_string_discriminants,
    typescript_svelte_state_modeling_violations,
};

#[test]
fn authored_rust_defines_no_macros() -> anyhow::Result<()> {
    let violations = authored_rust_macro_definitions(&repository_root())?;
    assert!(
        violations.is_empty(),
        "authored Rust must use explicit items and control flow instead of repository-defined macros: {violations:#?}"
    );
    Ok(())
}

#[test]
fn rust_tests_assert_known_json_through_typed_contracts() -> anyhow::Result<()> {
    let violations = rust_test_untyped_json_assertions(&repository_root())?;
    assert!(
        violations.is_empty(),
        "known JSON test contracts must round-trip through concrete Rust types; raw Value indexing and is_null assertions are forbidden: {violations:#?}"
    );
    Ok(())
}

#[test]
fn rust_tsify_boundaries_never_override_domain_state_with_absence_sentinels() -> anyhow::Result<()>
{
    let violations = rust_tsify_implicit_absence_overrides(&repository_root())?;
    assert!(
        violations.is_empty(),
        "Rust-owned Tsify contracts must use named state enums instead of undefined, null, or void type overrides: {violations:#?}"
    );
    Ok(())
}

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

#[test]
fn event_log_crate_keeps_the_portable_dependency_direction() -> anyhow::Result<()> {
    let root = repository_root();
    let event_log =
        fs::read_to_string(root.join("nook-app/nook-platform/nook-event-log/Cargo.toml"))?;
    assert!(event_log.contains("nook-auth2 ="));
    assert!(event_log.contains("nook-replication ="));
    for forbidden in ["nook-core =", "nook-wasm =", "web-sys =", "js-sys ="] {
        assert!(
            !event_log.contains(forbidden),
            "nook-event-log must not depend on {forbidden}"
        );
    }

    let core = fs::read_to_string(root.join("nook-app/nook-platform/nook-core/Cargo.toml"))?;
    assert!(core.contains("nook-event-log ="));
    assert!(
        !core.contains("nook-replication ="),
        "nook-core must consume replication through the event-log domain"
    );
    Ok(())
}

#[test]
fn shared_application_primitives_have_one_leaf_crate() -> anyhow::Result<()> {
    let root = repository_root();
    let common =
        fs::read_to_string(root.join("nook-app/nook-platform/nook-app-common/Cargo.toml"))?;
    for forbidden in [
        "nook-auth2 =",
        "nook-replication =",
        "nook-event-log =",
        "nook-core =",
        "nook-wasm =",
        "web-sys =",
        "js-sys =",
    ] {
        assert!(
            !common.contains(forbidden),
            "nook-app-common must remain a dependency-light leaf and not depend on {forbidden}"
        );
    }

    for consumer in ["nook-auth2", "nook-core"] {
        let manifest = fs::read_to_string(root.join(format!("nook-app/{consumer}/Cargo.toml")))?;
        assert!(
            manifest.contains("nook-app-common ="),
            "{consumer} must consume shared application primitives from nook-app-common"
        );
    }

    assert!(
        root.join("nook-app/nook-platform/nook-app-common/src/generated/i18n_keys.rs")
            .is_file(),
        "nook-app-common must own the single generated Rust translation-key registry"
    );
    for obsolete in [
        "nook-app/nook-platform/nook-core/src/generated/i18n_keys.rs",
        "nook-app/nook-platform/nook-auth2/src/generated/i18n_keys.rs",
        "nook-app/nook-platform/nook-core/locales/en.json",
        "nook-app/nook-platform/nook-core/locales/ru.json",
    ] {
        assert!(
            !root.join(obsolete).exists(),
            "obsolete per-crate translation-key registry must stay deleted: {obsolete}"
        );
    }
    Ok(())
}

#[test]
fn portable_core_does_not_import_browser_runtime_crates() -> anyhow::Result<()> {
    let violations = portable_core_browser_dependencies(&repository_root())?;
    assert!(
        violations.is_empty(),
        "portable Rust crates must stay browser-independent: {violations:#?}"
    );
    Ok(())
}

#[test]
fn typescript_domain_boundary_stays_generated_and_direct() -> anyhow::Result<()> {
    let violations = typescript_domain_boundary_boilerplate(&repository_root())?;
    assert!(
        violations.is_empty(),
        "vault domain schemas belong in Rust; use generated WASM types and direct exports instead of TypeScript mirrors or forwarding wrappers: {violations:#?}"
    );
    Ok(())
}

#[test]
fn typescript_does_not_clone_through_json_serialization() -> anyhow::Result<()> {
    let violations = typescript_json_round_trip_clones(&repository_root())?;
    assert!(
        violations.is_empty(),
        "authored TypeScript and Svelte must use direct values or $state.snapshot at reactive boundaries, never JSON parse/stringify cloning: {violations:#?}"
    );
    Ok(())
}

#[test]
fn authored_javascript_typescript_and_svelte_never_use_null() -> anyhow::Result<()> {
    let violations = typescript_null_absence_sentinels(&repository_root())?;
    assert!(
        violations.is_empty(),
        "authored JavaScript, TypeScript, and Svelte must normalize external null without authoring null values or types: {violations:#?}"
    );
    Ok(())
}

#[test]
fn typescript_svelte_state_keeps_domain_ids_precise() -> anyhow::Result<()> {
    let violations = typescript_svelte_state_modeling_violations(&repository_root())?;
    assert!(
        violations.is_empty(),
        "redundant optional expressions are forbidden, Rust-owned identifiers must stay typed, and domain state unions must be Rust/WASM enums: {violations:#?}"
    );
    Ok(())
}

#[test]
fn authored_javascript_typescript_and_svelte_never_use_undefined() -> anyhow::Result<()> {
    let violations = typescript_implicit_application_state(&repository_root())?;
    assert!(
        violations.is_empty(),
        "authored JavaScript, TypeScript, and Svelte must use explicit state and boundary adapters instead of undefined: {violations:#?}"
    );
    Ok(())
}

#[test]
fn typescript_value_contracts_never_hide_absence_behind_void() -> anyhow::Result<()> {
    let violations = typescript_mutable_void_state(&repository_root())?;
    assert!(
        violations.is_empty(),
        "TypeScript and Svelte value contracts must use explicit state, never T | void in storage, parameters, returns, or nested generics: {violations:#?}"
    );
    Ok(())
}

#[test]
fn typescript_state_names_explain_the_domain_transition() -> anyhow::Result<()> {
    let violations = typescript_generic_optional_state(&repository_root())?;
    assert!(
        violations.is_empty(),
        "generic Option-style wrappers are forbidden; use domain-specific union names and variants: {violations:#?}"
    );
    Ok(())
}

#[test]
fn typescript_closed_vocabularies_use_enums() -> anyhow::Result<()> {
    let violations = typescript_raw_string_discriminants(&repository_root())?;
    assert!(
        violations.is_empty(),
        "closed TypeScript and Svelte discriminants must reference named enum members instead of raw string literal types: {violations:#?}"
    );
    Ok(())
}

#[test]
fn rust_wasm_domain_boundary_stays_real_and_typed() -> anyhow::Result<()> {
    let violations = rust_wasm_domain_boundary_escape_hatches(&repository_root())?;
    assert!(
        violations.is_empty(),
        "WASM domain DTOs must use real Rust ABI types; unchecked TypeScript hints and raw provider/auth JsValue signatures are forbidden: {violations:#?}"
    );
    Ok(())
}

#[test]
fn remote_vault_recovery_requires_core_confirmed_connect_state() -> anyhow::Result<()> {
    let source = fs::read_to_string(
        repository_root()
            .join("nook-app/nook-web/nook-web-shared/src/vault-app/lib/vault/secrets.ts"),
    )?;
    assert!(
        source.contains("remoteRecoveryConnectConfirmed("),
        "loadDb must ask Rust policy whether remote recovery was explicitly confirmed"
    );
    assert!(
        !source.contains("remoteVaultRecoveryState === RemoteVaultRecoveryState.None &&"),
        "prompt states must never bypass remote-vault assessment and enter connect"
    );
    Ok(())
}
