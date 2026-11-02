//! The S3 provider at the WASM boundary: the setup form's validation, the
//! row helpers the provider screens need, and what an S3 location holds
//! before it is saved.
//!
//! Rust validates every field and reads the location; the web only renders
//! the typed results. A refused key rejects like every export, with the
//! message `provider_failure_code` classifies as `S3KeyAccessDenied`.
use super::wasm_bindgen;
use crate::NookError;
use crate::storage::provider_vault_listing::{
    BrowserHeldVaults, LocalVaultClassification, ProviderLocation,
};
use crate::storage::s3::{S3Storage, S3VaultListing};
use nook_core::{
    LocalVaultOccupancy, ProviderVaultListing, S3Connection, S3ConnectionDraft, S3DraftValidation,
};
use tsify::Tsify;
use wasm_bindgen::JsError;

const INVALID_TYPED_INPUT: &str = "Typed WASM value could not be converted.";
const UNENCODABLE_TYPED_OUTPUT: &str = "Typed WASM output could not be encoded.";

/// Validate the S3 setup form field by field. A valid form yields the
/// connection a new S3 row is saved with and an S3 source reads; an invalid
/// one names each wrong field with the translation key saying why.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_s3_connection_draft(
    draft: &tsify::Ts<S3ConnectionDraft>,
) -> Result<tsify::Ts<S3DraftValidation>, JsError> {
    let draft = draft.to_rust().map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Tsify::into_ts(&draft.validate()).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
}

/// The detail line of a validated S3 connection, as its saved row shows
/// it: `host[:port] · accessKeyId`. It never names the secret.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_s3_provider_detail(
    configuration: &tsify::Ts<S3Connection>,
) -> Result<String, JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    Ok(configuration.storage_detail())
}

/// List the vaults at an S3 location without saving or connecting to it,
/// each with how this device can open it, as a Google Drive account's are.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn list_s3_vaults(
    configuration: &tsify::Ts<S3Connection>,
    local_vault: &tsify::Ts<LocalVaultOccupancy>,
) -> Result<tsify::Ts<ProviderVaultListing>, JsError> {
    let configuration = configuration
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    let local_vault = local_vault
        .to_rust()
        .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
    let listing = S3ProviderListing {
        connection: &configuration,
        local_vault: &local_vault,
    }
    .listing()
    .await?;
    Tsify::into_ts(&listing).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
}

/// One S3 location and the vault open on this device.
struct S3ProviderListing<'a> {
    connection: &'a S3Connection,
    local_vault: &'a LocalVaultOccupancy,
}

impl S3ProviderListing<'_> {
    async fn listing(self) -> Result<ProviderVaultListing, NookError> {
        let location = S3VaultListing {
            storage: S3Storage {
                connection: self.connection,
            },
        };
        let held = BrowserHeldVaults::load().await?;
        let observations = location.observations().await?;
        let identity_logs = location.identity_logs(held.listing_key.as_ref()).await?;
        let inspected = location
            .inspect_vaults(&held.unheld(&observations), held.app_id.as_ref())
            .await?;
        Ok(LocalVaultClassification {
            local_vault: self.local_vault,
        }
        .listing(observations, &held, &inspected, &identity_logs))
    }
}

#[cfg(test)]
mod tests {
    use super::staged_s3_provider_detail;
    use crate::public_api::{
        NookAccessCheckSource, NookStagedStorageArgsState, draft_storage_args,
        provider_draft_label, s3_provider_draft, staged_storage_args,
    };
    use nook_core::{
        DraftStorageConnection, ProviderDraft, ProviderKind, S3Connection, S3ConnectionDraft,
        StorageConnection,
    };
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    const SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    fn configuration() -> anyhow::Result<S3Connection> {
        Ok(S3Connection::try_from(S3ConnectionDraft {
            endpoint: "http://127.0.0.1:8333".to_owned(),
            region: "us-east-1".to_owned(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "e2e".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: SECRET.to_owned(),
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
                    "keyPrefix": { "state": "prefix", "value": "e2e" },
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
    fn an_s3_draft_stages_its_connect_arguments_once_ready() -> anyhow::Result<()> {
        let ready = s3_provider_draft(&typed(&configuration()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let staged = staged_storage_args(&ready).map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(staged.state(), NookStagedStorageArgsState::Ready);
        let args = staged
            .args()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(
            args,
            StorageConnection::S3 {
                connection: configuration()?
            }
        );
        let awaiting = staged_storage_args(&typed(&ProviderDraft::begin(ProviderKind::S3))?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(awaiting.state(), NookStagedStorageArgsState::Incomplete);
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
    fn an_s3_draft_reports_its_label_detail_and_connect_arguments() -> anyhow::Result<()> {
        let ready = s3_provider_draft(&typed(&configuration()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(
            provider_draft_label(&ready).map_err(|error| anyhow::anyhow!("{error:?}"))?,
            "S3 · nook-dev/e2e"
        );
        let detail = staged_s3_provider_detail(&typed(&configuration()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(detail, "127.0.0.1:8333 · device-a");
        assert!(!detail.contains(SECRET));
        let args = draft_storage_args(&ready)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(
            args,
            DraftStorageConnection::Ready {
                connection: StorageConnection::S3 {
                    connection: configuration()?
                }
            }
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::list_s3_vaults;
    use crate::public_api::provider_failure_code;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use nook_core::{LocalVaultOccupancy, ProviderFailureCode, S3Connection, S3ConnectionDraft};
    use tsify::Tsify;
    use wasm_bindgen::JsCast;
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
    async fn a_403_from_the_server_rejects_the_listing_as_a_refused_key() -> anyhow::Result<()> {
        let _stub = FetchStub::install(vec![FetchRoute::failing("GET", "127.0.0.1:8333", 403)])
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let configuration = S3Connection::try_from(S3ConnectionDraft {
            endpoint: "http://127.0.0.1:8333".to_owned(),
            region: "us-east-1".to_owned(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "e2e".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: "TEST-ONLY-device-a-secret-not-real".to_owned(),
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
        let message = js_sys::Error::unchecked_from_js(failure.into())
            .message()
            .as_string()
            .unwrap_or_default();
        assert_eq!(
            provider_failure_code(&message),
            ProviderFailureCode::S3KeyAccessDenied
        );
        Ok(())
    }
}
