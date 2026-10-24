use super::{NookError, wasm_bindgen};
use nook_core::{SecretValue, TotpDigits};
use zeroize::Zeroizing;

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecretRecord {
    record: nook_core::SecretRecord,
}

impl Drop for NookSecretRecord {
    fn drop(&mut self) {
        self.record.zeroize_plaintext();
    }
}

#[wasm_bindgen]
impl NookSecretRecord {
    pub(crate) fn from_record(record: nook_core::SecretRecord) -> Self {
        Self { record }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.record.id.to_string()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn secret_type(&self) -> nook_core::SecretType {
        self.record.secret_type
    }

    #[wasm_bindgen(getter, js_name = displayTitle)]
    pub fn display_title(&self) -> String {
        self.record.display_title()
    }

    #[wasm_bindgen(getter, js_name = groupKey)]
    pub fn group_key(&self) -> String {
        self.record.group_key()
    }

    #[wasm_bindgen(getter, js_name = summary)]
    pub fn summary(&self) -> String {
        self.record.summary()
    }

    #[wasm_bindgen]
    pub fn matches_search(&self, query: &str) -> bool {
        self.record.matches_search(query)
    }

    #[wasm_bindgen(getter, js_name = primaryCredential)]
    pub fn primary_credential(&self) -> String {
        self.record.primary_credential().to_owned()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        match &self.record.data {
            SecretValue::Login(value) => value.website_url.clone(),
            SecretValue::ApiKey(value) => value.website_url.clone(),
            SecretValue::Authenticator(value) => value.website_url.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        match &self.record.data {
            SecretValue::Login(value) => value.username.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn password(&self) -> String {
        match &self.record.data {
            SecretValue::Login(value) => value.password.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn notes(&self) -> String {
        match &self.record.data {
            SecretValue::Login(value) => value.notes.clone(),
            SecretValue::CreditCard(value) => value.notes.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = key)]
    pub fn api_key(&self) -> String {
        match &self.record.data {
            SecretValue::ApiKey(value) => value.key.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expiresAt)]
    pub fn expires_at(&self) -> String {
        match &self.record.data {
            SecretValue::ApiKey(value) => value.expires_at.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        match &self.record.data {
            SecretValue::SeedPhrase(value) => value.name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn seed(&self) -> String {
        match &self.record.data {
            SecretValue::SeedPhrase(value) => value.seed.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    #[allow(clippy::match_same_arms)]
    pub fn title(&self) -> String {
        match &self.record.data {
            SecretValue::SecureNote(value) => value.title.clone(),
            SecretValue::CreditCard(value) => value.title.clone(),
            SecretValue::FileAttachment(value) => value.title.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn note(&self) -> String {
        match &self.record.data {
            SecretValue::SecureNote(value) => value.note.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = cardholderName)]
    pub fn cardholder_name(&self) -> String {
        match &self.record.data {
            SecretValue::CreditCard(value) => value.cardholder_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = cardNumber)]
    pub fn card_number(&self) -> String {
        match &self.record.data {
            SecretValue::CreditCard(value) => value.number.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn last4(&self) -> String {
        match &self.record.data {
            SecretValue::CreditCard(value) => value.last4(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationMonth)]
    pub fn expiration_month(&self) -> String {
        match &self.record.data {
            SecretValue::CreditCard(value) => value.expiration_month.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationYear)]
    pub fn expiration_year(&self) -> String {
        match &self.record.data {
            SecretValue::CreditCard(value) => value.expiration_year.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn cvv(&self) -> String {
        match &self.record.data {
            SecretValue::CreditCard(value) => value.cvv.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = fileName)]
    pub fn file_name(&self) -> String {
        match &self.record.data {
            SecretValue::FileAttachment(value) => value.file_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = mimeType)]
    pub fn mime_type(&self) -> String {
        match &self.record.data {
            SecretValue::FileAttachment(value) => value.mime_type.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = sizeBytes)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `size_bytes` count through a JavaScript Number scalar"
        )
    )]
    pub fn size_bytes(&self) -> u32 {
        match &self.record.data {
            SecretValue::FileAttachment(value) => {
                u32::try_from(u64::from(value.size_bytes)).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    #[wasm_bindgen(getter, js_name = contentBase64)]
    pub fn content_base64(&self) -> String {
        match &self.record.data {
            SecretValue::FileAttachment(value) => value.content_base64.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = rpId)]
    pub fn rp_id(&self) -> String {
        match &self.record.data {
            SecretValue::Passkey(value) => value.rp_id.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        match &self.record.data {
            SecretValue::Authenticator(value) => value.issuer.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserName)]
    pub fn passkey_user_name(&self) -> String {
        match &self.record.data {
            SecretValue::Passkey(value) => value.user_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        match &self.record.data {
            SecretValue::Authenticator(value) => value.account.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserDisplayName)]
    pub fn passkey_user_display_name(&self) -> String {
        match &self.record.data {
            SecretValue::Passkey(value) => value.user_display_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = totpSecret)]
    pub fn totp_secret(&self) -> String {
        match &self.record.data {
            SecretValue::Authenticator(value) => value.secret.as_str().to_owned(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn algorithm(&self) -> String {
        match &self.record.data {
            SecretValue::Authenticator(value) => value.algorithm.as_str().to_owned(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `digits` count through a JavaScript Number scalar"
        )
    )]
    pub fn digits(&self) -> u32 {
        match &self.record.data {
            SecretValue::Authenticator(value) => match value.digits {
                TotpDigits::Six => 6,
                TotpDigits::Seven => 7,
                TotpDigits::Eight => 8,
            },
            _ => 0,
        }
    }

    #[wasm_bindgen(getter)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `period` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn period(&self) -> u32 {
        match &self.record.data {
            SecretValue::Authenticator(value) => {
                u32::try_from(u64::from(value.period)).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    /// Every plaintext field of a person, address, identity-document, or
    /// international-account, or domestic-account record plus masked numbers.
    /// Other types throw.
    #[wasm_bindgen(getter, js_name = personalData)]
    pub fn personal_data(
        &self,
    ) -> Result<tsify::Ts<nook_core::PersonalDataView>, wasm_bindgen::JsError> {
        let view = Zeroizing::new(
            nook_core::PersonalDataView::from_value(&self.record.data).map_err(NookError::from)?,
        );
        tsify::Ts::from_rust(&*view)
            .map_err(|_| wasm_bindgen::JsError::new("Typed WASM output could not be encoded."))
    }

    #[wasm_bindgen(getter, js_name = backupCodes)]
    pub fn backup_codes(&self) -> Vec<String> {
        match &self.record.data {
            SecretValue::Authenticator(value) => value.backup_codes.clone(),
            _ => Vec::new(),
        }
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod personal_data_wasm_tests {
    use super::NookSecretRecord;
    use crate::{
        NookSecretFormFields, NookSecretListItem, build_secret_yaml, secret_type_category,
    };
    use nook_core::{SecretCategory, SecretId, SecretRecord, SecretType, SecretValue};
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn dto<T: tsify::Tsify>(value: &serde_json::Value) -> Result<tsify::Ts<T>, JsError> {
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        serde::Serialize::serialize(value, &serializer)
            .map(tsify::Ts::new_unchecked)
            .map_err(|_| JsError::new("Typed test input could not be encoded."))
    }

    fn decoded(yaml: &str, secret_type: SecretType) -> Result<SecretRecord, JsError> {
        Ok(SecretRecord {
            id: SecretId::from_vault_record("secret_personal"),
            secret_type,
            data: SecretValue::from_yaml_str(secret_type, yaml)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    fn view_json(record: &NookSecretRecord) -> Result<serde_json::Value, JsError> {
        serde_wasm_bindgen::from_value(record.personal_data()?.into())
            .map_err(|_| JsError::new("Typed test output could not be decoded."))
    }

    #[wasm_bindgen_test]
    fn identity_document_list_masks_number_while_detail_reveals_it() -> Result<(), JsError> {
        let fields = NookSecretFormFields::identity_document(&dto(&serde_json::json!({
            "kind": "passport",
            "number": " X1234567 ",
            "issuer": "HM Passport Office",
            "issuingCountry": "GB",
            "issueDate": "2020-01-15",
            "expiryDate": "2030-01",
            "nameAsPrinted": "ADA LOVELACE",
        }))?)?;
        let record = decoded(&build_secret_yaml(&fields)?, SecretType::IdentityDocument)?;
        let item = NookSecretListItem::from_core(record.list_item(), String::new());
        assert_eq!(item.secret_type(), SecretType::IdentityDocument);
        assert_eq!(item.display_title(), "ADA LOVELACE");
        assert_eq!(item.summary(), "•••• 4567");
        for exposed in [
            item.display_title(),
            item.summary(),
            item.title(),
            item.last4(),
        ] {
            assert!(!exposed.contains("X1234567"));
        }

        let detail = NookSecretRecord::from_record(record);
        assert_eq!(
            view_json(&detail)?,
            serde_json::json!({
                "kind": "identity-document",
                "documentKind": "passport",
                "number": "X1234567",
                "maskedNumber": "•••• 4567",
                "issuer": "HM Passport Office",
                "issuingCountry": "GB",
                "issueDate": "2020-01-15",
                "expiryDate": "2030-01",
                "nameAsPrinted": "ADA LOVELACE",
            })
        );
        assert_eq!(detail.primary_credential(), "X1234567");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn international_account_list_masks_iban_and_detail_carries_bic() -> Result<(), JsError> {
        let fields = NookSecretFormFields::international_account(&dto(&serde_json::json!({
            "accountHolder": "Ada Lovelace",
            "bankName": "Analytical Bank",
            "iban": "gb82 west 1234 5698 7654 32",
            "swiftBic": "nwbkgb2l",
        }))?)?;
        let record = decoded(
            &build_secret_yaml(&fields)?,
            SecretType::InternationalAccount,
        )?;
        let item = NookSecretListItem::from_core(record.list_item(), String::new());
        assert_eq!(item.summary(), "•••• 5432 · NWBKGB2L");
        assert!(!item.summary().contains("GB82WEST"));
        assert_eq!(
            view_json(&NookSecretRecord::from_record(record))?,
            serde_json::json!({
                "kind": "international-account",
                "accountHolder": "Ada Lovelace",
                "bankName": "Analytical Bank",
                "iban": "GB82WEST12345698765432",
                "maskedNumber": "•••• 5432",
                "swiftBic": "NWBKGB2L",
            })
        );
        let non_iban = NookSecretFormFields::international_account(&dto(&serde_json::json!({
            "accountHolder": "", "bankName": "", "iban": "000123456789", "swiftBic": "",
        }))?)?;
        assert!(build_secret_yaml(&non_iban).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn domestic_account_list_masks_number_and_detail_carries_routing_number() -> Result<(), JsError>
    {
        let fields = NookSecretFormFields::domestic_account(&dto(&serde_json::json!({
            "accountHolder": "Ada Lovelace",
            "bankName": "Federal Bank",
            "accountNumber": "0001-2345-6789",
            "routingNumber": "021000021",
        }))?)?;
        let record = decoded(&build_secret_yaml(&fields)?, SecretType::DomesticAccount)?;
        let item = NookSecretListItem::from_core(record.list_item(), String::new());
        assert_eq!(item.summary(), "•••• 6789 · 021000021");
        assert!(!item.summary().contains("000123456789"));
        assert_eq!(
            view_json(&NookSecretRecord::from_record(record))?,
            serde_json::json!({
                "kind": "domestic-account",
                "accountHolder": "Ada Lovelace",
                "bankName": "Federal Bank",
                "accountNumber": "000123456789",
                "maskedNumber": "•••• 6789",
                "routingNumber": "021000021",
            })
        );
        let bad_routing = NookSecretFormFields::domestic_account(&dto(&serde_json::json!({
            "accountHolder": "", "bankName": "", "accountNumber": "1234",
            "routingNumber": "021000022",
        }))?)?;
        assert!(build_secret_yaml(&bad_routing).is_err());
        assert!(
            NookSecretFormFields::domestic_account(&dto(&serde_json::json!({
                "accountHolder": "", "bankName": "", "accountNumber": "1234",
                "routingCode": "021000021",
            }))?)
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn person_and_address_forms_validate_and_expose_typed_detail_views() -> Result<(), JsError> {
        let person = NookSecretFormFields::person(&dto(&serde_json::json!({
            "givenName": "Ada", "middleName": "", "familyName": "Lovelace",
            "birthDate": "1815-12-10", "email": "ada@example.com",
            "mobilePhone": "+44 20 7946 0958", "homePhone": "", "workPhone": "",
        }))?)?;
        let record = decoded(&build_secret_yaml(&person)?, SecretType::Person)?;
        assert_eq!(
            view_json(&NookSecretRecord::from_record(record))?,
            serde_json::json!({
                "kind": "person",
                "givenName": "Ada",
                "middleName": "",
                "familyName": "Lovelace",
                "fullName": "Ada Lovelace",
                "birthDate": "1815-12-10",
                "email": "ada@example.com",
                "mobilePhone": "+44 20 7946 0958",
                "homePhone": "",
                "workPhone": "",
            })
        );

        let address = NookSecretFormFields::address(&dto(&serde_json::json!({
            "label": "Home", "addressLine1": "", "addressLine2": "", "city": "London",
            "region": "", "postalCode": "", "country": "GB",
        }))?)?;
        assert!(build_secret_yaml(&address).is_err());
        assert!(
            NookSecretFormFields::address(&dto(&serde_json::json!({ "label": "Home" }))?).is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn card_records_keep_card_getters_and_have_no_personal_view() -> Result<(), JsError> {
        let card = NookSecretRecord::from_record(decoded(
            "title: Card\ncardholderName: ''\nnumber: '4111111111111111'\nexpirationMonth: ''\nexpirationYear: ''\ncvv: ''\nnotes: ''\n",
            SecretType::CreditCard,
        )?);
        assert_eq!(card.card_number(), "4111111111111111");
        assert!(card.personal_data().is_err());
        assert_eq!(
            secret_type_category(SecretType::CreditCard),
            SecretCategory::PersonalData
        );
        assert_eq!(
            secret_type_category(SecretType::Login),
            SecretCategory::Secrets
        );
        assert_eq!(
            secret_type_category(SecretType::DomesticAccount),
            SecretCategory::PersonalData
        );
        assert_eq!(
            secret_type_category(SecretType::InternationalAccount),
            SecretCategory::PersonalData
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        ApiKeySecret, AuthenticatorSecret, CreditCardSecret, FileAttachmentByteCount,
        FileAttachmentSecret, LoginSecret, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8,
        PasskeyPublicKeyCose, PasskeySecret, PasskeySecretVersion, PasskeySignatureCount, SecretId,
        SecretRecord, SecretType, SecretValue, SecureNoteSecret, SeedPhraseSecret, TotpAlgorithm,
        TotpDigits, TotpPeriod, TotpSecret,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn record(secret_type: SecretType, data: SecretValue) -> NookSecretRecord {
        NookSecretRecord::from_record(SecretRecord {
            id: SecretId::from_vault_record("record-1"),
            secret_type,
            data,
        })
    }

    #[wasm_bindgen_test]
    fn login_and_api_key_projections_expose_typed_fields() {
        let login = record(
            SecretType::Login,
            SecretValue::Login(LoginSecret {
                website_url: "https://example.test/login".into(),
                username: "alice".into(),
                password: "password".into(),
                notes: "login notes".into(),
            }),
        );
        assert_eq!(login.id(), "record-1");
        assert_eq!(login.secret_type(), SecretType::Login);
        assert_eq!(login.website_url(), "https://example.test/login");
        assert_eq!(login.username(), "alice");
        assert_eq!(login.password(), "password");
        assert_eq!(login.notes(), "login notes");
        assert_eq!(login.api_key(), "");
        assert!(login.matches_search("alice"));

        let api_key = record(
            SecretType::ApiKey,
            SecretValue::ApiKey(ApiKeySecret {
                website_url: "https://api.example.test".into(),
                key: "api-key".into(),
                expires_at: "2030-01-01".into(),
            }),
        );
        assert_eq!(api_key.secret_type(), SecretType::ApiKey);
        assert_eq!(api_key.website_url(), "https://api.example.test");
        assert_eq!(api_key.api_key(), "api-key");
        assert_eq!(api_key.expires_at(), "2030-01-01");
        assert_eq!(api_key.username(), "");
        assert_eq!(api_key.password(), "");
    }

    #[wasm_bindgen_test]
    fn seed_note_card_and_attachment_projections_expose_typed_fields() {
        let seed = record(
            SecretType::SeedPhrase,
            SecretValue::SeedPhrase(SeedPhraseSecret {
                name: "Recovery".into(),
                seed: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".into(),
            }),
        );
        assert_eq!(seed.name(), "Recovery");
        assert!(seed.seed().starts_with("abandon"));

        let note = record(
            SecretType::SecureNote,
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".into(),
                note: "contents".into(),
            }),
        );
        assert_eq!(note.title(), "Private note");
        assert_eq!(note.note(), "contents");
        assert_eq!(note.summary(), "Private note");

        let card = record(
            SecretType::CreditCard,
            SecretValue::CreditCard(CreditCardSecret {
                title: "Travel card".into(),
                cardholder_name: "Alice".into(),
                number: "4111111111111111".into(),
                expiration_month: "12".into(),
                expiration_year: "2030".into(),
                cvv: "123".into(),
                notes: "card notes".into(),
            }),
        );
        assert_eq!(card.title(), "Travel card");
        assert_eq!(card.cardholder_name(), "Alice");
        assert_eq!(card.card_number(), "4111111111111111");
        assert_eq!(card.last4(), "1111");
        assert_eq!(card.expiration_month(), "12");
        assert_eq!(card.expiration_year(), "2030");
        assert_eq!(card.cvv(), "123");
        assert_eq!(card.notes(), "card notes");

        let attachment = record(
            SecretType::FileAttachment,
            SecretValue::FileAttachment(FileAttachmentSecret {
                title: "Export".into(),
                file_name: "export.json".into(),
                mime_type: "application/json".into(),
                size_bytes: FileAttachmentByteCount::from(42),
                content_base64: "e30=".into(),
            }),
        );
        assert_eq!(attachment.title(), "Export");
        assert_eq!(attachment.file_name(), "export.json");
        assert_eq!(attachment.mime_type(), "application/json");
        assert_eq!(attachment.size_bytes(), 42);
        assert_eq!(attachment.content_base64(), "e30=");
    }

    #[wasm_bindgen_test]
    fn passkey_and_authenticator_projections_expose_typed_fields() {
        let passkey = record(
            SecretType::Passkey,
            SecretValue::Passkey(PasskeySecret {
                version: PasskeySecretVersion::CURRENT,
                rp_id: "example.test".into(),
                rp_name: "Example".into(),
                credential_id: "credential".into(),
                user_handle: "handle".into(),
                user_name: "alice".into(),
                user_display_name: "Alice".into(),
                key: PasskeyCredentialKey::Es256 {
                    private_key_pkcs8: PasskeyPrivateKeyPkcs8::parse("AQ").unwrap(),
                    public_key_cose: PasskeyPublicKeyCose::parse("Ag").unwrap(),
                },
                signature_count: PasskeySignatureCount::ZERO,
                discoverable: true,
                backup_eligible: false,
                backup_state: false,
            }),
        );
        assert_eq!(passkey.rp_id(), "example.test");
        assert_eq!(passkey.passkey_user_name(), "alice");
        assert_eq!(passkey.passkey_user_display_name(), "Alice");

        let authenticator = record(
            SecretType::Authenticator,
            SecretValue::Authenticator(AuthenticatorSecret {
                issuer: "Example".into(),
                account: "alice".into(),
                website_url: "https://example.test".into(),
                secret: TotpSecret::parse("JBSWY3DPEHPK3PXP").unwrap(),
                algorithm: TotpAlgorithm::Sha1,
                digits: TotpDigits::Six,
                period: TotpPeriod::try_from(30).unwrap(),
                backup_codes: vec!["A1B2-C3D4".into()],
            }),
        );
        assert_eq!(authenticator.issuer(), "Example");
        assert_eq!(authenticator.account(), "alice");
        assert_eq!(authenticator.totp_secret(), "JBSWY3DPEHPK3PXP");
        assert_eq!(authenticator.algorithm(), "SHA1");
        assert_eq!(authenticator.digits(), 6);
        assert_eq!(authenticator.period(), 30);
        assert_eq!(authenticator.backup_codes(), vec!["A1B2-C3D4"]);
    }
}
