//! Writes example vault files to `nook-core/fixtures/` for inspection.
//!
//! Run: `cargo run --example generate_vault_fixtures -p nook-core`

use nook_core::{ApiKeySecret, Database, SecretId, SecretValue, VaultFormat};
use std::fs;
use std::path::PathBuf;

fn api_key(website_url: &str, key: &str) -> SecretValue {
    SecretValue::ApiKey(ApiKeySecret {
        website_url: website_url.to_owned(),
        key: key.to_owned(),
        expires_at: String::new(),
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fixtures_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    fs::create_dir_all(&fixtures_dir).map_err(|e| format!("create fixtures dir: {e}"))?;

    let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";

    let mut db = Database::new();
    db.insert(
        SecretId::from_vault_record("github.com"),
        api_key("https://github.com", "hunter2"),
    );
    db.insert(
        SecretId::from_vault_record("work-vpn"),
        api_key("https://vpn.example.com", "token-abc"),
    );
    db.insert(
        SecretId::from_vault_record("notes"),
        api_key("https://notes.example.com", "multiline\nsecret\nwith\ttabs"),
    );

    let session_jsonl = db.to_jsonl()?;
    let stored_yaml = db.to_stored(passphrase, VaultFormat::Yaml)?;
    let stored_jsonl = db.to_stored(passphrase, VaultFormat::Jsonl)?;

    fs::write(fixtures_dir.join("session.example.jsonl"), &session_jsonl)
        .map_err(|e| format!("write session.example.jsonl: {e}"))?;
    fs::write(fixtures_dir.join("nook-vault.example.yaml"), &stored_yaml)
        .map_err(|e| format!("write nook-vault.example.yaml: {e}"))?;
    fs::write(fixtures_dir.join("nook-vault.example.jsonl"), &stored_jsonl)
        .map_err(|e| format!("write nook-vault.example.jsonl: {e}"))?;

    println!("Wrote fixtures to {}", fixtures_dir.display());
    println!("  session.example.jsonl     — plaintext in-memory format (WASM session only)");
    println!("  nook-vault.example.yaml   — encrypted on-disk format (GitHub / IndexedDB)");
    println!("  nook-vault.example.jsonl  — same data, JSONL on-disk format (also supported)");
    Ok(())
}
