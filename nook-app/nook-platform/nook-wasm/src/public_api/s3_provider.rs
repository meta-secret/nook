//! The S3 provider at the WASM boundary: the setup form's validation, the
//! row helpers the provider screens need, and what an S3 location holds
//! before it is saved.
//!
//! Rust validates every field and reads the location; the web only renders
//! the typed results. A refused key rejects like every export, with the
//! message `provider_failure_code` classifies as `S3KeyAccessDenied`.
use super::wasm_bindgen;
use crate::storage::provider_vault_listing::ProviderLocation;
use crate::storage::s3::{S3Storage, S3VaultListing};
use crate::{TypedInput, TypedOutput};
use nook_core::{
    LocalVaultOccupancy, ProviderVaultListing, S3Connection, S3ConnectionDraft, S3DraftValidation,
    S3EndpointService, S3KnownService, S3ServiceGuide,
};
use wasm_bindgen::JsError;

/// Validate the S3 setup form field by field. A valid form yields the
/// connection a new S3 row is saved with and an S3 source reads; an invalid
/// one names each wrong field with the translation key saying why.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn validate_s3_connection_draft(
    draft: &tsify::Ts<S3ConnectionDraft>,
) -> Result<tsify::Ts<S3DraftValidation>, JsError> {
    let draft = draft.decode()?;
    Ok(draft.validate().encode()?)
}

/// The detail line of a validated S3 connection, as its saved row shows
/// it: `host[:port] · accessKeyId`. It never names the secret.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_s3_provider_detail(
    configuration: &tsify::Ts<S3Connection>,
) -> Result<String, JsError> {
    let configuration = configuration.decode()?;
    Ok(configuration.storage_detail())
}

/// Every S3-compatible service the setup form offers, each with its endpoint
/// and region formats and the console page that issues its access keys.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn s3_service_guides(
) -> Result<Vec<tsify::Ts<S3ServiceGuide>>, JsError> {
    S3KnownService::guides()
        .iter()
        .map(|guide| Ok(guide.encode()?))
        .collect()
}

/// The service a typed S3 endpoint belongs to, judged by its host.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn s3_endpoint_service(
    endpoint: &str,
) -> Result<tsify::Ts<S3EndpointService>, JsError> {
    Ok(S3EndpointService::for_endpoint(endpoint).encode()?)
}

/// List the vaults at an S3 location without saving or connecting to it,
/// each with how this device can open it, as a Google Drive account's are.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn list_s3_vaults(
    configuration: &tsify::Ts<S3Connection>,
    local_vault: &tsify::Ts<LocalVaultOccupancy>,
) -> Result<tsify::Ts<ProviderVaultListing>, JsError> {
    let configuration = configuration.decode()?;
    let local_vault = local_vault.decode()?;
    let listing = S3VaultListing {
        storage: S3Storage {
            connection: &configuration,
        },
    }
    .listing(&local_vault)
    .await?;
    Ok(listing.encode()?)
}

#[cfg(test)]
mod tests {
    use super::staged_s3_provider_detail;
    use crate::public_api::{
        NookAccessCheckSource, NookRemoteSource, NookStagedStorageArgsState, draft_storage_args,
        provider_draft_label, s3_provider_draft, staged_storage_args,
    };
    use crate::test_fixtures::WasmFixture;
    use crate::{TypedInput, TypedOutput};
    use nook_core::{DraftStorageConnection, ProviderDraft, ProviderKind, StorageConnection};
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn typed<T: Tsify + serde::Serialize>(value: &T) -> anyhow::Result<tsify::Ts<T>> {
        Ok(value.encode()?)
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
        let source = serde_json::to_value(NookAccessCheckSource::Remote(NookRemoteSource::S3 {
            configuration: WasmFixture::s3_connection()?,
        }))?;
        assert_eq!(
            source,
            serde_json::json!({
                "kind": "remote",
                "source": {
                "kind": "s3",
                "configuration": {
                    "endpoint": "http://127.0.0.1:8333",
                    "region": "us-east-1",
                    "bucket": "nook-dev",
                    "keyPrefix": { "state": "prefix", "value": "e2e" },
                    "accessKeyId": "device-a",
                    "secretAccessKey": WasmFixture::S3_SECRET,
                },
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
        let ready = s3_provider_draft(&typed(&WasmFixture::s3_connection()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let staged = staged_storage_args(&ready).map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(staged.state(), NookStagedStorageArgsState::Ready);
        let args = staged
            .args()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .decode()?;
        assert_eq!(
            args,
            StorageConnection::S3 {
                connection: WasmFixture::s3_connection()?
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
        let ready = s3_provider_draft(&typed(&WasmFixture::s3_connection()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(
            provider_draft_label(&ready).map_err(|error| anyhow::anyhow!("{error:?}"))?,
            "S3 · nook-dev/e2e"
        );
        let detail = staged_s3_provider_detail(&typed(&WasmFixture::s3_connection()?)?)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(detail, "127.0.0.1:8333 · device-a");
        assert!(!detail.contains(WasmFixture::S3_SECRET));
        let args = draft_storage_args(&ready)
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .decode()?;
        assert_eq!(
            args,
            DraftStorageConnection::Ready {
                connection: StorageConnection::S3 {
                    connection: WasmFixture::s3_connection()?
                }
            }
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::list_s3_vaults;
    use crate::TypedOutput;
    use crate::public_api::provider_failure_code;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::test_fixtures::WasmFixture;
    use nook_core::{LocalVaultOccupancy, ProviderFailureCode};
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
        let configuration = WasmFixture::s3_connection()?;
        let rejected = list_s3_vaults(
            &configuration.encode()?,
            &LocalVaultOccupancy::Closed.encode()?,
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
