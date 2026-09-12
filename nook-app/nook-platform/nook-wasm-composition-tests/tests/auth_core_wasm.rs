use anyhow::Result;
use nook_core::{PasswordGenerationOptions, VaultApplication};
use nook_wasm::ConfiguredVaultApplication;

struct AuthCoreWasmComposition;

impl AuthCoreWasmComposition {
    fn symmetric_key() -> Result<nook_auth2::SymmetricKey> {
        Ok(nook_auth2::SymmetricKey::parse(&"ab".repeat(32))?)
    }
}

#[test]
fn auth2_key_is_accepted_by_core_crypto() -> Result<()> {
    let key = AuthCoreWasmComposition::symmetric_key()?;
    let crypto = nook_core::VaultCrypto::new(&key)?;
    let ciphertext = crypto.encrypt_value("composition boundary")?;
    assert_eq!(
        crypto.decrypt_value(&ciphertext)?.as_str(),
        "composition boundary"
    );
    Ok(())
}

#[test]
fn core_password_options_are_accepted_by_nook_wasm() -> Result<()> {
    let options: PasswordGenerationOptions = nook_wasm::default_password_generation_options();
    let password = nook_wasm::generate_password(options)
        .map_err(|_| anyhow::anyhow!("nook WASM rejected valid core password options"))?;
    assert_eq!(password.len(), 20);
    Ok(())
}

#[test]
fn core_application_capability_constructs_real_wasm_manager() {
    ConfiguredVaultApplication::configure_vault_application(VaultApplication::UnifiedDevelopment);
    let manager = nook_wasm::NookVaultManager::new();
    assert_eq!(
        manager.vault_application(),
        VaultApplication::UnifiedDevelopment
    );
}

#[test]
fn auth2_store_id_is_the_same_core_domain_type() -> Result<()> {
    let generated = nook_auth2::StoreId::generate()?;
    let through_core: nook_core::StoreId = generated.clone();
    assert_eq!(through_core, generated);
    Ok(())
}

#[test]
fn malformed_auth2_store_id_is_rejected_before_wasm_storage() {
    assert!(nook_auth2::StoreId::parse("store with spaces").is_err());
}

#[test]
fn core_password_policy_rejects_an_empty_character_set() {
    let options = PasswordGenerationOptions {
        lowercase: nook_core::PasswordCharacterSet::Excluded,
        uppercase: nook_core::PasswordCharacterSet::Excluded,
        numbers: nook_core::PasswordCharacterSet::Excluded,
        symbols: nook_core::PasswordCharacterSet::Excluded,
        ..PasswordGenerationOptions::default()
    };
    assert!(options.validate().is_err());
}
