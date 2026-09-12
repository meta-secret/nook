use super::{
    NookError, NookJoinRequest, NookSecretListItem, NookSecretRecord, NookVaultMember, wasm_bindgen,
};
use nook_core::SecretFormFields;
use std::mem;

#[wasm_bindgen]
pub struct NookSecretPage {
    items: Vec<NookSecretListItem>,
    total: u32,
    offset: u32,
    limit: u32,
}

impl NookSecretPage {
    pub(crate) fn from_core(page: nook_core::SecretPage) -> Result<Self, NookError> {
        let group_keys = page
            .entity_group_keys()
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(Self {
            items: page
                .records
                .into_iter()
                .zip(group_keys)
                .map(|(item, group_key)| {
                    NookSecretListItem::from_core(item, group_key.into_string())
                })
                .collect(),
            total: u32::try_from(usize::from(page.total)).unwrap_or(u32::MAX),
            offset: u32::try_from(usize::from(page.offset)).unwrap_or(u32::MAX),
            limit: u32::try_from(usize::from(page.limit)).unwrap_or(u32::MAX),
        })
    }
}

#[wasm_bindgen]
impl NookSecretPage {
    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the secret-page total as a JavaScript Number scalar"
        )
    )]
    pub fn total(&self) -> u32 {
        self.total
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `offset` paging values through JavaScript Number scalars"
        )
    )]
    pub fn offset(&self) -> u32 {
        self.offset
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `limit` paging values through JavaScript Number scalars"
        )
    )]
    pub fn limit(&self) -> u32 {
        self.limit
    }

    /// Transfer page-owned metadata items to JavaScript without cloning them.
    #[wasm_bindgen]
    pub fn take_items(&mut self) -> Vec<NookSecretListItem> {
        mem::take(&mut self.items)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookImportResult {
    imported: u32,
    skipped_unsupported: u32,
    skipped_duplicates: u32,
}

#[wasm_bindgen]
impl NookImportResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `imported` numeric values through JavaScript Number scalars"
        )
    )]
    pub fn imported(&self) -> u32 {
        self.imported
    }

    #[wasm_bindgen(getter, js_name = skippedUnsupported)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `skipped_unsupported` numeric values through JavaScript Number scalars"
        )
    )]
    pub fn skipped_unsupported(&self) -> u32 {
        self.skipped_unsupported
    }

    #[wasm_bindgen(getter, js_name = skippedDuplicates)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `skipped_duplicates` numeric values through JavaScript Number scalars"
        )
    )]
    pub fn skipped_duplicates(&self) -> u32 {
        self.skipped_duplicates
    }

    pub(crate) fn new(
        imported: usize,
        skipped_unsupported: usize,
        skipped_duplicates: usize,
    ) -> Self {
        Self {
            imported: u32::try_from(imported).unwrap_or(u32::MAX),
            skipped_unsupported: u32::try_from(skipped_unsupported).unwrap_or(u32::MAX),
            skipped_duplicates: u32::try_from(skipped_duplicates).unwrap_or(u32::MAX),
        }
    }
}

/// Variant-specific form payload for `build_secret_yaml`.
#[wasm_bindgen]
pub struct NookSecretFormFields {
    pub(crate) inner: nook_core::SecretFormFields,
}

#[wasm_bindgen]
impl NookSecretFormFields {
    #[wasm_bindgen]
    pub fn login(website_url: String, username: String, password: String, notes: String) -> Self {
        Self {
            inner: SecretFormFields::Login(nook_core::LoginSecretForm {
                website_url,
                username,
                password,
                notes,
            }),
        }
    }

    #[wasm_bindgen]
    pub fn api_key(website_url: String, key: String, expires_at: String) -> Self {
        Self {
            inner: SecretFormFields::ApiKey(nook_core::ApiKeySecretForm {
                website_url,
                key,
                expires_at,
            }),
        }
    }

    #[wasm_bindgen]
    pub fn seed_phrase(name: String, seed: String) -> Self {
        Self {
            inner: SecretFormFields::SeedPhrase(nook_core::SeedPhraseSecretForm { name, seed }),
        }
    }

    #[wasm_bindgen]
    pub fn secure_note(title: String, note: String) -> Self {
        Self {
            inner: SecretFormFields::SecureNote(nook_core::SecureNoteSecretForm { title, note }),
        }
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn authenticator(
        issuer: String,
        account: String,
        website_url: String,
        totp_secret: String,
        algorithm: String,
        digits: String,
        period: String,
        backup_codes: String,
    ) -> Self {
        Self {
            inner: SecretFormFields::Authenticator(nook_core::AuthenticatorSecretForm {
                issuer,
                account,
                website_url,
                totp_secret,
                algorithm,
                digits,
                period,
                backup_codes,
            }),
        }
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn credit_card(
        title: String,
        cardholder_name: String,
        number: String,
        expiration_month: String,
        expiration_year: String,
        cvv: String,
        notes: String,
    ) -> Self {
        Self {
            inner: SecretFormFields::CreditCard(nook_core::CreditCardSecretForm {
                title,
                cardholder_name,
                number,
                expiration_month,
                expiration_year,
                cvv,
                notes,
            }),
        }
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `file_attachment` count through a JavaScript Number scalar"
        )
    )]
    pub fn file_attachment(
        title: String,
        file_name: String,
        mime_type: String,
        size_bytes: u32,
        content_base64: String,
    ) -> Self {
        Self {
            inner: SecretFormFields::FileAttachment(nook_core::FileAttachmentSecretForm {
                title,
                file_name,
                mime_type,
                size_bytes: u64::from(size_bytes).into(),
                content_base64,
            }),
        }
    }
}

#[wasm_bindgen]
pub struct NookTotpCode {
    code: String,
    seconds_remaining: u32,
    period: u32,
    expires_at_unix_seconds: f64,
}

#[wasm_bindgen]
impl NookTotpCode {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    #[wasm_bindgen(getter, js_name = secondsRemaining)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects remaining TOTP seconds as a JavaScript Number scalar"
        )
    )]
    pub fn seconds_remaining(&self) -> u32 {
        self.seconds_remaining
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `period` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn period(&self) -> u32 {
        self.period
    }

    #[wasm_bindgen(getter, js_name = expiresAtUnixSeconds)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `expires_at_unix_seconds` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn expires_at_unix_seconds(&self) -> f64 {
        self.expires_at_unix_seconds
    }

    #[allow(clippy::cast_precision_loss)]
    pub(crate) fn from_core(value: nook_core::TotpCode, unix_seconds: u64) -> Self {
        let seconds_remaining =
            u32::try_from(u64::from(value.seconds_remaining)).unwrap_or(u32::MAX);
        Self {
            code: value.code,
            seconds_remaining,
            period: u32::try_from(u64::from(value.period)).unwrap_or(u32::MAX),
            expires_at_unix_seconds: unix_seconds as f64 + f64::from(seconds_remaining),
        }
    }
}

impl Drop for NookTotpCode {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.code.zeroize();
    }
}

impl NookSecretRecord {
    pub(crate) fn records_to_vec(
        records: Vec<nook_core::SecretRecord>,
    ) -> Result<Vec<NookSecretRecord>, NookError> {
        Ok(records
            .into_iter()
            .map(NookSecretRecord::from_record)
            .collect())
    }
}

impl NookJoinRequest {
    pub(crate) fn joins_to_vec(joins: Vec<nook_core::JoinRequest>) -> Vec<NookJoinRequest> {
        joins.into_iter().map(NookJoinRequest::from_core).collect()
    }
}

impl NookVaultMember {
    pub(crate) fn members_to_vec(members: Vec<nook_core::VaultMember>) -> Vec<NookVaultMember> {
        members
            .into_iter()
            .map(NookVaultMember::from_core)
            .collect()
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::NookSecretFormFields;
    use nook_core::SecretFormFields;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn file_attachment_builder_preserves_the_typed_payload() {
        let fields = NookSecretFormFields::file_attachment(
            "Recovery codes".to_owned(),
            "recovery.txt".to_owned(),
            "text/plain".to_owned(),
            17,
            "cmVjb3ZlcnkgY29kZXM=".to_owned(),
        );

        let SecretFormFields::FileAttachment(attachment) = fields.inner else {
            panic!("file attachment constructor must preserve its variant");
        };
        assert_eq!(attachment.title, "Recovery codes");
        assert_eq!(attachment.file_name, "recovery.txt");
        assert_eq!(attachment.mime_type, "text/plain");
        assert_eq!(u64::from(attachment.size_bytes), 17);
        assert_eq!(attachment.content_base64, "cmVjb3ZlcnkgY29kZXM=");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn secret_form_builders_preserve_each_typed_variant() {
        assert!(matches!(
            NookSecretFormFields::login("url".into(), "user".into(), "pass".into(), "notes".into())
                .inner,
            SecretFormFields::Login(_)
        ));
        assert!(matches!(
            NookSecretFormFields::api_key("url".into(), "key".into(), "2030".into()).inner,
            SecretFormFields::ApiKey(_)
        ));
        assert!(matches!(
            NookSecretFormFields::seed_phrase("backup".into(), "words".into()).inner,
            SecretFormFields::SeedPhrase(_)
        ));
        assert!(matches!(
            NookSecretFormFields::secure_note("title".into(), "note".into()).inner,
            SecretFormFields::SecureNote(_)
        ));
        assert!(matches!(
            NookSecretFormFields::authenticator(
                "issuer".into(),
                "account".into(),
                "url".into(),
                "secret".into(),
                "SHA1".into(),
                "6".into(),
                "30".into(),
                "backup".into(),
            )
            .inner,
            SecretFormFields::Authenticator(_)
        ));
        assert!(matches!(
            NookSecretFormFields::credit_card(
                "title".into(),
                "Alice".into(),
                "4111".into(),
                "01".into(),
                "2030".into(),
                "123".into(),
                "notes".into(),
            )
            .inner,
            SecretFormFields::CreditCard(_)
        ));
    }

    #[wasm_bindgen_test]
    fn secret_page_import_and_totp_wrappers_project_values() -> anyhow::Result<()> {
        let mut page = NookSecretPage::from_core(nook_core::SecretPage {
            records: Vec::new(),
            total: 3.into(),
            offset: 1.into(),
            limit: 2.into(),
        })?;
        assert_eq!(page.total(), 3);
        assert_eq!(page.offset(), 1);
        assert_eq!(page.limit(), 2);
        assert!(page.take_items().is_empty());

        let result = NookImportResult::new(2, 1, 3);
        assert_eq!(result.imported(), 2);
        assert_eq!(result.skipped_unsupported(), 1);
        assert_eq!(result.skipped_duplicates(), 3);

        let totp = NookTotpCode::from_core(
            nook_core::TotpCode {
                code: "123456".into(),
                seconds_remaining: 17.into(),
                period: nook_core::TotpPeriod::default(),
            },
            100,
        );
        assert_eq!(totp.code(), "123456");
        assert_eq!(totp.seconds_remaining(), 17);
        assert_eq!(totp.period(), 30);
        assert_eq!(
            totp.expires_at_unix_seconds().to_bits(),
            117.0_f64.to_bits()
        );
        Ok(())
    }
}
