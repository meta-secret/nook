use super::wasm_bindgen;
use nook_core::{SecretValue, TotpDigits};

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
                u32::try_from(value.size_bytes).unwrap_or(u32::MAX)
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
                u32::try_from(value.period.serialized_value()).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    #[wasm_bindgen(getter, js_name = backupCodes)]
    pub fn backup_codes(&self) -> Vec<String> {
        match &self.record.data {
            SecretValue::Authenticator(value) => value.backup_codes.clone(),
            _ => Vec::new(),
        }
    }
}
