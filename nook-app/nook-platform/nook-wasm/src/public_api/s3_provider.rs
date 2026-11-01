//! The S3 provider at the WASM boundary: the setup form's validation, the
//! row helpers the provider screens need, and what an S3 location holds
//! before it is saved.
//!
//! Rust validates every field and reads the location; the web only renders
//! the typed results. A refused key surfaces as a `NookProviderFailure` whose
//! `code` is `s3-key-access-denied`.
use super::NookStorageConnectArgs;
use super::wasm_bindgen;
use crate::storage::provider_vault_listing::{BrowserHeldVaults, LocalVaultClassification};
use crate::storage::s3::{S3Storage, S3VaultListing};
use crate::{NookError, NookVaultManager};
use js_sys::Error as JsNativeError;
use nook_core::{
    LocalVaultOccupancy, ProviderLabel, ProviderVaultListing, S3ConnectionDraft, S3DraftValidation,
    S3ProviderConfig, StoredS3Configuration,
};
use tsify::Tsify;
use wasm_bindgen::JsError;

const INVALID_TYPED_INPUT: &str = "Typed WASM value could not be converted.";
const UNENCODABLE_TYPED_OUTPUT: &str = "Typed WASM output could not be encoded.";

/// Validate the S3 setup form field by field. A valid form yields the
/// configuration a new S3 row is saved with and an S3 source reads; an
/// invalid one names each wrong field with the translation key saying why.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_s3_connection_draft(
    draft: &tsify::Ts<S3ConnectionDraft>,
) -> Result<tsify::Ts<S3DraftValidation>, JsError> {
    let draft = draft.to_rust().map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Tsify::into_ts(&draft.validate()).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookStoredS3ConfigurationState {
    NotApplicable,
    Configured,
}

/// Whether a provider row carries its S3 connection.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn stored_s3_configuration_state(
    configuration: &tsify::Ts<StoredS3Configuration>,
) -> Result<NookStoredS3ConfigurationState, JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Ok(match configuration {
        StoredS3Configuration::NotApplicable => NookStoredS3ConfigurationState::NotApplicable,
        StoredS3Configuration::Configured(_) => NookStoredS3ConfigurationState::Configured,
    })
}

/// The label an S3 provider is staged and saved with: `S3 · bucket[/prefix]`.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_s3_provider_label(
    configuration: &tsify::Ts<StoredS3Configuration>,
) -> Result<String, JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Ok(ProviderLabel::S3(&configuration).render())
}

/// The detail line of a validated S3 configuration, as its saved row shows
/// it: `host[:port] · accessKeyId`. It never names the secret.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_s3_provider_detail(
    configuration: &tsify::Ts<S3ProviderConfig>,
) -> Result<String, JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Ok(configuration.storage_detail())
}

/// The connect arguments of a validated S3 configuration that is not saved
/// yet: `s3`, the secret in the credential slot, and the versioned reference.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn draft_s3_storage_args(
    configuration: &tsify::Ts<S3ProviderConfig>,
) -> Result<tsify::Ts<NookStorageConnectArgs>, JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Tsify::into_ts(&configuration.connect_args()?)
        .map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
}

/// List the vaults at an S3 location without saving or connecting to it,
/// each with how this device can open it, as a Google Drive account's are.
/// A key the server refuses fails with the `s3-key-access-denied` code.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn list_s3_vaults(
    configuration: &tsify::Ts<S3ProviderConfig>,
    local_vault: &tsify::Ts<LocalVaultOccupancy>,
) -> Result<tsify::Ts<ProviderVaultListing>, JsNativeError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsNativeError::new(INVALID_TYPED_INPUT))?;
    let local_vault = local_vault
        .to_rust()
        .map_err(|_| JsNativeError::new(INVALID_TYPED_INPUT))?;
    let listing = S3ProviderListing {
        configuration: &configuration,
        local_vault: &local_vault,
    }
    .listing()
    .await
    .map_err(NookVaultManager::assessment_failure_js_error)?;
    Tsify::into_ts(&listing).map_err(|_| JsNativeError::new(UNENCODABLE_TYPED_OUTPUT))
}

/// One S3 location and the vault open on this device.
struct S3ProviderListing<'a> {
    configuration: &'a S3ProviderConfig,
    local_vault: &'a LocalVaultOccupancy,
}

impl S3ProviderListing<'_> {
    async fn listing(self) -> Result<ProviderVaultListing, NookError> {
        let connection = self.configuration.connection()?;
        let location = S3VaultListing {
            storage: S3Storage {
                connection: &connection,
            },
        };
        let held = BrowserHeldVaults::load().await?;
        let observations = location.observations().await?;
        let identity_logs = location.identity_logs(&held).await?;
        let inspected = location.inspect_vaults(&held, &observations).await?;
        Ok(LocalVaultClassification {
            local_vault: self.local_vault,
        }
        .listing(observations, &held, &inspected, &identity_logs))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        NookStoredS3ConfigurationState, draft_s3_storage_args, staged_s3_provider_detail,
        staged_s3_provider_label, stored_s3_configuration_state,
    };
    use crate::public_api::NookAccessCheckSource;
    use nook_core::{S3ConnectionDraft, S3ProviderConfig, StoredS3Configuration};
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    fn configuration() -> anyhow::Result<S3ProviderConfig> {
        Ok(S3ProviderConfig::try_from(S3ConnectionDraft {
            endpoint: "http://127.0.0.1:8333".to_owned(),
            region: "us-east-1".to_owned(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "e2e".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: SECRET.to_owned().into(),
        })?)
    }

    fn typed<T: Tsify + serde::Serialize>(value: &T) -> anyhow::Result<tsify::Ts<T>> {
        Tsify::into_ts(value).map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn an_s3_source_names_its_validated_configuration() -> anyhow::Result<()> {
        // The provider source of setup, recovery, and joins has the same shape.
        let source = serde_json::to_value(NookAccessCheckSource::S3 {
            configuration: configuration()?,
        })?;
        assert_eq!(
            source,
            serde_json::json!({
                "kind": "s3",
                "configuration": {
                    "endpoint": "http://127.0.0.1:8333",
                    "region": "us-east-1",
                    "bucket": "nook-dev",
                    "keyPrefix": "e2e",
                    "accessKeyId": "device-a",
                    "secretAccessKey": SECRET,
                },
            })
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn rows_report_their_s3_block_label_and_connect_arguments() -> anyhow::Result<()> {
        let configured = StoredS3Configuration::Configured(configuration()?);
        let state = |configuration: &StoredS3Configuration| {
            stored_s3_configuration_state(&typed(configuration)?)
                .map_err(|error| anyhow::anyhow!("{error:?}"))
        };
        assert_eq!(
            state(&configured)?,
            NookStoredS3ConfigurationState::Configured
        );
        assert_eq!(
            state(&StoredS3Configuration::NotApplicable)?,
            NookStoredS3ConfigurationState::NotApplicable
        );
        assert_eq!(
            staged_s3_provider_label(&typed(&configured)?)
                .map_err(|error| anyhow::anyhow!("{error:?}"))?,
            "S3 · nook-dev/e2e"
        );
        let detail = staged_s3_provider_detail(&typed(&configuration()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(detail, "127.0.0.1:8333 · device-a");
        assert!(!detail.contains(SECRET));
        let args = draft_s3_storage_args(&typed(&configuration()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(args.mode, "s3");
        assert_eq!(args.pat, SECRET);
        assert!(
            args.repo
                .starts_with(nook_core::S3_CONNECT_TARGET_V1_PREFIX)
        );
        assert!(!args.repo.contains(SECRET));
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::list_s3_vaults;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use js_sys::Reflect;
    use nook_core::{LocalVaultOccupancy, S3ConnectionDraft, S3ProviderConfig};
    use tsify::Tsify;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn a_403_from_the_server_rejects_the_listing_with_the_refused_key_code()
    -> anyhow::Result<()> {
        let _stub = FetchStub::install(vec![FetchRoute::failing("GET", "127.0.0.1:8333", 403)])
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let configuration = S3ProviderConfig::try_from(S3ConnectionDraft {
            endpoint: "http://127.0.0.1:8333".to_owned(),
            region: "us-east-1".to_owned(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "e2e".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: "TEST-ONLY-device-a-secret-not-real".to_owned().into(),
        })?;
        let rejected = list_s3_vaults(
            &Tsify::into_ts(&configuration).map_err(|error| anyhow::anyhow!("{error:?}"))?,
            &Tsify::into_ts(&LocalVaultOccupancy::Closed)
                .map_err(|error| anyhow::anyhow!("{error:?}"))?,
        )
        .await;
        let Err(failure) = rejected else {
            anyhow::bail!("a refused key fails the listing");
        };
        let code = Reflect::get(&failure, &JsValue::from_str("code"))
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .as_string();
        assert_eq!(code.as_deref(), Some("s3-key-access-denied"));
        assert_eq!(
            failure.name().as_string().as_deref(),
            Some("NookProviderFailure")
        );
        Ok(())
    }
}
