use super::{NookError, NookSecretFormFields, types, wasm_bindgen};

mod secret_record;

pub use secret_record::NookSecretRecord;

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum NookSecretTypeFilter {
    All,
    Login,
    ApiKey,
    SeedPhrase,
    SecureNote,
    Passkey,
    Authenticator,
    CreditCard,
    FileAttachment,
}

impl NookSecretTypeFilter {
    pub(crate) const fn to_core(self) -> nook_core::SecretTypeFilter {
        match self {
            Self::All => nook_core::SecretTypeFilter::All,
            Self::Login => nook_core::SecretTypeFilter::Only(nook_core::SecretType::Login),
            Self::ApiKey => nook_core::SecretTypeFilter::Only(nook_core::SecretType::ApiKey),
            Self::SeedPhrase => {
                nook_core::SecretTypeFilter::Only(nook_core::SecretType::SeedPhrase)
            }
            Self::SecureNote => {
                nook_core::SecretTypeFilter::Only(nook_core::SecretType::SecureNote)
            }
            Self::Passkey => nook_core::SecretTypeFilter::Only(nook_core::SecretType::Passkey),
            Self::Authenticator => {
                nook_core::SecretTypeFilter::Only(nook_core::SecretType::Authenticator)
            }
            Self::CreditCard => {
                nook_core::SecretTypeFilter::Only(nook_core::SecretType::CreditCard)
            }
            Self::FileAttachment => {
                nook_core::SecretTypeFilter::Only(nook_core::SecretType::FileAttachment)
            }
        }
    }
}

#[wasm_bindgen]
#[must_use]
pub fn secret_type_name(secret_type: nook_core::SecretType) -> String {
    secret_type.as_str().to_owned()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecretListItem {
    item: nook_core::SecretListItem,
    /// Entity-resolved clustering key for vault list cards.
    group_key: String,
}

#[wasm_bindgen]
impl NookSecretListItem {
    pub(crate) fn from_core(item: nook_core::SecretListItem, group_key: String) -> Self {
        Self { item, group_key }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.item.id.to_string()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn secret_type(&self) -> nook_core::SecretType {
        self.item.secret_type()
    }

    #[wasm_bindgen(getter, js_name = typeName)]
    pub fn secret_type_name(&self) -> String {
        self.item.secret_type().as_str().to_owned()
    }

    #[wasm_bindgen(getter, js_name = displayTitle)]
    pub fn display_title(&self) -> String {
        self.item.display_title()
    }

    #[wasm_bindgen(getter, js_name = groupKey)]
    pub fn group_key(&self) -> String {
        self.group_key.clone()
    }

    #[wasm_bindgen(getter, js_name = summary)]
    pub fn summary(&self) -> String {
        self.item.summary()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Login { website_url, .. }
            | nook_core::SecretListItemData::ApiKey { website_url, .. }
            | nook_core::SecretListItemData::Authenticator { website_url, .. } => {
                website_url.clone()
            }
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = websiteHost)]
    pub fn website_host(&self) -> String {
        self.item.website_host()
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Login { username, .. } => username.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expiresAt)]
    pub fn expires_at(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::ApiKey { expires_at, .. } => expires_at.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::SeedPhrase { name, .. } => name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = seedWordCount)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `seed_word_count` count through a JavaScript Number scalar"
        )
    )]
    pub fn seed_word_count(&self) -> u32 {
        match self.item.data {
            nook_core::SecretListItemData::SeedPhrase { word_count, .. } => {
                u32::try_from(word_count).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn title(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::SecureNote { title }
            | nook_core::SecretListItemData::CreditCard { title, .. }
            | nook_core::SecretListItemData::FileAttachment { title, .. } => title.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = cardholderName)]
    pub fn cardholder_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard {
                cardholder_name, ..
            } => cardholder_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn last4(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard { last4, .. } => last4.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationMonth)]
    pub fn expiration_month(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard {
                expiration_month, ..
            } => expiration_month.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationYear)]
    pub fn expiration_year(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard {
                expiration_year, ..
            } => expiration_year.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = fileName)]
    pub fn file_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::FileAttachment { file_name, .. } => file_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = mimeType)]
    pub fn mime_type(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::FileAttachment { mime_type, .. } => mime_type.clone(),
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
        match self.item.data {
            nook_core::SecretListItemData::FileAttachment { size_bytes, .. } => {
                u32::try_from(size_bytes).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    #[wasm_bindgen(getter, js_name = rpId)]
    pub fn rp_id(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Authenticator { issuer, .. } => issuer.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserName)]
    pub fn passkey_user_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Passkey { user_name, .. } => user_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Authenticator { account, .. } => account.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserDisplayName)]
    pub fn passkey_user_display_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Passkey {
                user_display_name, ..
            } => user_display_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = backupCodeCount)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `backup_code_count` count through a JavaScript Number scalar"
        )
    )]
    pub fn backup_code_count(&self) -> u32 {
        match self.item.data {
            nook_core::SecretListItemData::Authenticator {
                backup_code_count, ..
            } => u32::try_from(backup_code_count).unwrap_or(u32::MAX),
            _ => 0,
        }
    }
}

/// Serialize validated form fields into the YAML payload expected by `add_secret`.
fn build_secret_yaml_inner(fields: &NookSecretFormFields) -> Result<String, NookError> {
    Ok(nook_core::build_secret_yaml_from_form(&fields.inner)?
        .as_str()
        .to_owned())
}

#[wasm_bindgen]
pub fn build_secret_yaml(fields: &NookSecretFormFields) -> Result<String, wasm_bindgen::JsError> {
    build_secret_yaml_inner(fields).map_err(Into::into)
}

#[wasm_bindgen]
pub fn authenticator_setup_key_changed(
    stored_key: &str,
    candidate_key: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    nook_core::authenticator_setup_key_changed(stored_key, candidate_key)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen]
pub fn preview_otpauth_uri(uri: &str) -> Result<types::NookOtpauthPreview, wasm_bindgen::JsError> {
    nook_core::AuthenticatorSecret::preview_otpauth_uri(uri)
        .map(types::NookOtpauthPreview::from_core)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen]
pub fn current_code_from_otpauth_uri(
    uri: &str,
) -> Result<types::NookTotpCode, wasm_bindgen::JsError> {
    let millis = js_sys::Date::now();
    if !(millis.is_finite() && millis >= 0.0) {
        return Err(NookError::from(nook_core::ValidationError::AuthenticatorSecretInvalid).into());
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let unix_seconds = (millis / 1000.0) as u64;
    nook_core::AuthenticatorSecret::current_code_from_otpauth_uri(uri, unix_seconds)
        .map(|code| types::NookTotpCode::from_core(code, unix_seconds))
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn normalize_backup_codes(codes: Vec<String>) -> Result<Vec<String>, wasm_bindgen::JsError> {
    // Owned `Vec<String>` is required by the wasm-bindgen JS array boundary.
    nook_core::normalize_backup_codes(&codes)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn apply_backup_codes(
    existing: Vec<String>,
    incoming: Vec<String>,
    mode: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    // Owned `Vec<String>` is required by the wasm-bindgen JS array boundary.
    let mode = nook_core::BackupCodeAttachMode::parse(mode).map_err(|_| {
        NookError::from(nook_core::ValidationError::AuthenticatorBackupCodesInvalid)
    })?;
    nook_core::apply_backup_codes(&existing, &incoming, mode)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use crate::{
        NookAuthenticationOutcomeObservation, NookAuthenticationPageObservation,
        NookAuthenticationPageObservations, NookAuthenticationWorkflowMatchState, NookSecretPage,
        authentication_workflow_snapshot, classify_authentication_outcome_with_default_timeout,
        generate_totp_code, verify_totp_code, wasm_storage_mode_for_provider,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn provider_storage_modes_round_trip_in_wasm() -> Result<(), wasm_bindgen::JsError> {
        assert_eq!(
            wasm_storage_mode_for_provider(
                nook_core::StorageProviderType::OauthFile,
                nook_core::OauthFilePreset::GoogleDrive,
            )?,
            "google-drive"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                nook_core::StorageProviderType::OauthFile,
                nook_core::OauthFilePreset::ICloud,
            )?,
            "icloud"
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn secure_note_builder_rejects_blank_content_at_the_wasm_boundary() {
        let fields =
            NookSecretFormFields::secure_note("Empty note".to_owned(), " \n\t ".to_owned());

        assert!(build_secret_yaml(&fields).is_err());
    }

    #[wasm_bindgen_test]
    fn totp_helpers_match_core_authenticator_for_fixture_seed() -> Result<(), wasm_bindgen::JsError>
    {
        let secret = "JBSWY3DPEHPK3PXP";
        let unix_seconds = 1_721_520_000_u64;
        let code = generate_totp_code(secret, unix_seconds)?;
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|b| b.is_ascii_digit()));
        assert!(verify_totp_code(secret, &code, unix_seconds)?);
        assert!(!verify_totp_code(secret, "000000", unix_seconds)?);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authentication_workflow_snapshot_preserves_core_policy() -> Result<(), wasm_bindgen::JsError>
    {
        let observation =
            NookAuthenticationPageObservation::new(1, 1, 0, 0, 0, false, false, false, false, 0);
        let mut observations = NookAuthenticationPageObservations::new();
        observations.add(&observation);
        let snapshot = authentication_workflow_snapshot(&observations).snapshot()?;

        assert_eq!(snapshot.kind_name(), "login");
        assert_eq!(snapshot.stage_name(), "credentials");
        assert_eq!(snapshot.action_name(), "continue-with-nook");
        assert_eq!(snapshot.current_step(), 1);
        assert_eq!(snapshot.total_steps(), 3);
        assert_eq!(
            snapshot.approval_requirement(),
            nook_core::AuthenticationApprovalRequirement::ExplicitUserApproval
        );
        assert_eq!(snapshot.observation_index(), 0);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn authentication_workflow_snapshot_rejects_out_of_bounds_observations() {
        let excessive_field_count = NookAuthenticationPageObservation::new(
            nook_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1,
            1,
            0,
            0,
            0,
            false,
            false,
            false,
            false,
            0,
        );
        let mut observations = NookAuthenticationPageObservations::new();
        observations.add(&excessive_field_count);
        assert_eq!(
            authentication_workflow_snapshot(&observations).state(),
            NookAuthenticationWorkflowMatchState::Rejected
        );

        let valid_login =
            NookAuthenticationPageObservation::new(1, 1, 0, 0, 0, false, false, false, false, 0);
        let mut observations = NookAuthenticationPageObservations::new();
        for _ in 0..=nook_core::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS {
            observations.add(&valid_login);
        }
        assert_eq!(
            authentication_workflow_snapshot(&observations).state(),
            NookAuthenticationWorkflowMatchState::Rejected
        );
    }

    #[wasm_bindgen_test]
    fn classify_authentication_outcome_preserves_core_policy() -> anyhow::Result<()> {
        let navigation_only =
            NookAuthenticationOutcomeObservation::new(true, false, false, false, false, false, 500);
        let navigation = classify_authentication_outcome_with_default_timeout(&navigation_only);
        assert_eq!(
            navigation.verdict(),
            nook_core::AuthenticationOutcomeVerdict::Insufficient
        );
        assert!(!navigation.allows_credential_commit());

        let success =
            NookAuthenticationOutcomeObservation::new(true, false, true, false, false, false, 300);
        let sufficient = classify_authentication_outcome_with_default_timeout(&success);
        assert_eq!(
            sufficient.verdict(),
            nook_core::AuthenticationOutcomeVerdict::Sufficient
        );
        assert!(sufficient.allows_credential_commit());

        let conflict =
            NookAuthenticationOutcomeObservation::new(false, true, true, true, false, false, 100);
        assert_eq!(
            classify_authentication_outcome_with_default_timeout(&conflict).verdict(),
            nook_core::AuthenticationOutcomeVerdict::Conflicting
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn list_item_exports_metadata_without_secret_accessors() {
        let item = NookSecretListItem::from_core(
            nook_core::SecretListItem {
                id: nook_core::SecretId::from_vault_record("secret_login"),
                data: nook_core::SecretListItemData::Login {
                    website_url: "https://example.com".to_owned(),
                    username: "alice".to_owned(),
                },
            },
            "example.com".to_owned(),
        );

        assert_eq!(item.id(), "secret_login");
        assert_eq!(item.secret_type(), nook_core::SecretType::Login);
        assert_eq!(item.website_url(), "https://example.com");
        assert_eq!(item.website_host(), "example.com");
        assert_eq!(item.username(), "alice");
        assert_eq!(item.summary(), "alice");
    }

    #[wasm_bindgen_test]
    fn passkey_list_item_exports_only_rp_and_account_metadata() {
        let item = NookSecretListItem::from_core(
            nook_core::SecretListItem {
                id: nook_core::SecretId::from_vault_record("secret_passkey"),
                data: nook_core::SecretListItemData::Passkey {
                    rp_id: "login.example.com".to_owned(),
                    rp_name: "Example".to_owned(),
                    user_name: "alice@example.com".to_owned(),
                    user_display_name: "Alice".to_owned(),
                },
            },
            "login.example.com".to_owned(),
        );

        assert_eq!(item.secret_type(), nook_core::SecretType::Passkey);
        assert_eq!(item.rp_id(), "login.example.com");
        assert_eq!(item.passkey_user_name(), "alice@example.com");
        assert_eq!(item.passkey_user_display_name(), "Alice");
    }

    #[wasm_bindgen_test]
    fn credit_card_list_and_detail_keep_distinct_secret_boundaries() -> anyhow::Result<()> {
        let card = nook_core::CreditCardSecret::from_fields(
            "Personal Visa",
            "Ada Lovelace",
            "4111111111111111",
            "12",
            "2030",
            "123",
            "private billing note",
        )?;
        let record = nook_core::SecretRecord {
            id: nook_core::SecretId::from_vault_record("secret_credit_card"),
            secret_type: nook_core::SecretType::CreditCard,
            data: nook_core::SecretValue::CreditCard(card),
        };
        let item = NookSecretListItem::from_core(record.list_item(), String::new());

        assert_eq!(item.secret_type(), nook_core::SecretType::CreditCard);
        assert_eq!(item.title(), "Personal Visa");
        assert_eq!(item.cardholder_name(), "Ada Lovelace");
        assert_eq!(item.last4(), "1111");
        assert_eq!(item.expiration_month(), "12");
        assert_eq!(item.expiration_year(), "2030");

        let detail = NookSecretRecord::from_record(record);
        assert_eq!(detail.card_number(), "4111111111111111");
        assert_eq!(detail.cvv(), "123");
        assert_eq!(detail.notes(), "private billing note");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn issuer_host_map_loads_under_wasm() {
        assert_eq!(
            nook_core::mapped_host_for_issuer("OpenAI"),
            Some("openai.com")
        );
        assert_eq!(
            nook_core::resolve_authenticator_website_host("", "GitHub"),
            Some("github.com".to_owned())
        );
        assert_eq!(
            nook_core::authenticator_group_key("", "Namecheap"),
            "namecheap.com"
        );
    }

    #[wasm_bindgen_test]
    fn page_resolves_brand_authenticator_onto_site_host() -> anyhow::Result<()> {
        let mut page = NookSecretPage::from_core(nook_core::SecretPage {
            records: vec![
                nook_core::SecretListItem {
                    id: nook_core::SecretId::from_vault_record("secret_login"),
                    data: nook_core::SecretListItemData::Login {
                        website_url: "https://namecheap.com".to_owned(),
                        username: "bynull".to_owned(),
                    },
                },
                nook_core::SecretListItem {
                    id: nook_core::SecretId::from_vault_record("secret_totp"),
                    data: nook_core::SecretListItemData::Authenticator {
                        issuer: "Namecheap".to_owned(),
                        account: "bynull".to_owned(),
                        website_url: String::new(),
                        backup_code_count: 0,
                    },
                },
            ],
            total: 2,
            offset: 0,
            limit: 50,
        })?;

        let items = page.take_items();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].group_key(), "namecheap.com");
        assert_eq!(items[1].group_key(), "namecheap.com");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn page_transfers_metadata_items_only_once() -> anyhow::Result<()> {
        let mut page = NookSecretPage::from_core(nook_core::SecretPage {
            records: vec![nook_core::SecretListItem {
                id: nook_core::SecretId::from_vault_record("secret_note"),
                data: nook_core::SecretListItemData::SecureNote {
                    title: "Recovery".to_owned(),
                },
            }],
            total: 1,
            offset: 0,
            limit: 50,
        })?;

        let items = page.take_items();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title(), "Recovery");
        assert!(page.take_items().is_empty());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::public_api::is_google_drive_shared_grant_request;
    use nook_core::{OauthFilePreset, ProviderOauthPreset, StorageProviderType};

    #[test]
    fn google_drive_grant_requires_explicit_preset() -> anyhow::Result<()> {
        assert!(!is_google_drive_shared_grant_request(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::NotApplicable,
        ));
        assert!(is_google_drive_shared_grant_request(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::GoogleDrive),
        ));
        assert!(!is_google_drive_shared_grant_request(
            StorageProviderType::OauthFile,
            ProviderOauthPreset::Preset(OauthFilePreset::ICloud),
        ));
        Ok(())
    }
}
