//! Writes example vault files to `nook-app/nook-platform/nook-core/fixtures/` for inspection.
//!
//! Run: `cargo run --example generate_vault_fixtures -p nook-core`

use nook_core::{ApiKeySecret, Database, SecretId, SecretValue};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
enum FixtureGenerationError {
    #[error("could not create the fixture directory")]
    CreateDirectory(#[source] std::io::Error),
    #[error("could not serialize the example vault")]
    SerializeVault(#[from] nook_core::DatabaseError),
    #[error("could not write nook-projection.example.yaml")]
    WriteFixture(#[source] std::io::Error),
}

fn api_key(website_url: &str, key: &str) -> SecretValue {
    SecretValue::ApiKey(ApiKeySecret {
        website_url: website_url.to_owned(),
        key: key.to_owned(),
        expires_at: String::new(),
    })
}

fn main() -> Result<(), FixtureGenerationError> {
    let fixtures_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    fs::create_dir_all(&fixtures_dir).map_err(FixtureGenerationError::CreateDirectory)?;

    let passphrase = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

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

    let stored_yaml = db.to_stored_yaml(passphrase)?;

    fs::write(
        fixtures_dir.join("nook-projection.example.yaml"),
        stored_yaml.as_str(),
    )
    .map_err(FixtureGenerationError::WriteFixture)?;

    println!("Wrote fixtures to {}", fixtures_dir.display());
    println!("  nook-projection.example.yaml   — encrypted on-disk format (GitHub / IndexedDB)");
    Ok(())
}
