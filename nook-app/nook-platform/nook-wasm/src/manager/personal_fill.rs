//! Personal-data reveal for an explicit extension form fill.
//!
//! Personal data is not site-bound: the request names one user-selected record,
//! its field group, and the planned kinds. Only those derived values cross the
//! boundary, and the Rust copies are zeroized after encoding.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{NookPersonalFillRequest, NookPersonalFillResponse};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

impl NookVaultManager {
    fn reveal_personal_fill_values(
        &self,
        request: &NookPersonalFillRequest,
    ) -> Result<NookPersonalFillResponse, NookError> {
        let crypto = self.vault.crypto.get()?;
        let record = nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto)
            .decrypt(&request.secret_id)?;
        let values = Zeroizing::new(
            nook_core::PersonalFillProjection {
                record,
                group: request.group,
                kinds: &request.kinds,
            }
            .reveal()
            .map_err(|error| NookError::Decryption(error.to_string()))?,
        );
        Ok(NookPersonalFillResponse::from(&*values))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Hydrates the retained extension vault session, then reveals one record's
    /// values for the planned personal-data fields.
    #[wasm_bindgen]
    pub async fn reveal_personal_data_for_fill(
        &mut self,
        request: tsify::Ts<NookPersonalFillRequest>,
    ) -> Result<tsify::Ts<NookPersonalFillResponse>, JsError> {
        let request = request
            .to_rust()
            .map_err(|_| JsError::new("Invalid personal data fill request."))?;
        // Same extension Simple Vault boundary as website login fill.
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let response = Zeroizing::new(self.reveal_personal_fill_values(&request)?);
        tsify::Ts::from_rust(&*response)
            .map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

#[cfg(test)]
mod tests {
    use super::NookVaultManager;
    use crate::manager::VaultCryptoState;
    use crate::types::NookPersonalFillRequest;
    use nook_core::{
        AddressFields, AddressSecret, CreditCardFields, CreditCardSecret, SecretId, SecretValue,
        StoredRecordPayload, VaultCrypto, VaultKeys,
    };
    use nook_page_policy::{PersonalFieldGroup, PersonalFieldKind};

    const ADDRESS_ID: &str = "secret_SMypl8K0w9a";
    const CARD_ID: &str = "secret_SMypl8K0w9b";

    /// Unlocked manager holding one address and one card.
    fn personal_vault() -> anyhow::Result<NookVaultManager> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut manager = NookVaultManager::new();
        let address = SecretValue::Address(AddressSecret::from_fields(AddressFields {
            label: "Home",
            address_line1: "12 Analytical Row",
            address_line2: "Flat 3",
            city: "London",
            region: "",
            postal_code: "W1 1AA",
            country: "GB",
        })?);
        let card = SecretValue::CreditCard(CreditCardSecret::from_fields(CreditCardFields {
            title: "Personal Visa",
            cardholder_name: "ADA LOVELACE",
            number: "4111111111111111",
            expiration_month: "12",
            expiration_year: "2030",
            cvv: "123",
            notes: "never projected",
        })?);
        for (id, value) in [(ADDRESS_ID, address), (CARD_ID, card)] {
            let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
            manager.vault.meta.secrets.insert(
                SecretId::parse(id)?,
                (
                    value.secret_type(),
                    StoredRecordPayload::from_age_armored(ciphertext),
                ),
            );
        }
        manager.vault.crypto = VaultCryptoState::Unlocked(crypto);
        Ok(manager)
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn reveals_only_planned_non_empty_values_of_the_selected_record() -> anyhow::Result<()> {
        let manager = personal_vault()?;
        let response = manager.reveal_personal_fill_values(&NookPersonalFillRequest {
            secret_id: SecretId::parse(ADDRESS_ID)?,
            group: PersonalFieldGroup::Address,
            kinds: vec![
                PersonalFieldKind::StreetAddress,
                PersonalFieldKind::AddressLevel1,
                PersonalFieldKind::PostalCode,
            ],
        })?;
        assert_eq!(
            serde_json::to_string(&response)?,
            r#"{"values":[{"kind":"StreetAddress","value":"12 Analytical Row\nFlat 3"},{"kind":"PostalCode","value":"W1 1AA"}]}"#
        );

        let card = manager.reveal_personal_fill_values(&NookPersonalFillRequest {
            secret_id: SecretId::parse(CARD_ID)?,
            group: PersonalFieldGroup::Card,
            kinds: vec![
                PersonalFieldKind::CardExpiration,
                PersonalFieldKind::CardSecurityCode,
            ],
        })?;
        assert_eq!(
            serde_json::to_string(&card)?,
            r#"{"values":[{"kind":"CardExpiration","value":"12/30"},{"kind":"CardSecurityCode","value":"123"}]}"#
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn rejects_group_mismatch_foreign_kinds_unknown_records_and_locked_vaults() -> anyhow::Result<()>
    {
        let manager = personal_vault()?;
        for request in [
            NookPersonalFillRequest {
                secret_id: SecretId::parse(CARD_ID)?,
                group: PersonalFieldGroup::Address,
                kinds: vec![PersonalFieldKind::PostalCode],
            },
            NookPersonalFillRequest {
                secret_id: SecretId::parse(ADDRESS_ID)?,
                group: PersonalFieldGroup::Address,
                kinds: vec![PersonalFieldKind::CardNumber],
            },
            NookPersonalFillRequest {
                secret_id: SecretId::parse("secret_SMypl8K0w9z")?,
                group: PersonalFieldGroup::Person,
                kinds: vec![PersonalFieldKind::GivenName],
            },
        ] {
            assert!(manager.reveal_personal_fill_values(&request).is_err());
        }
        assert!(
            NookVaultManager::new()
                .reveal_personal_fill_values(&NookPersonalFillRequest {
                    secret_id: SecretId::parse(CARD_ID)?,
                    group: PersonalFieldGroup::Card,
                    kinds: vec![PersonalFieldKind::CardNumber],
                })
                .is_err()
        );
        Ok(())
    }
}
