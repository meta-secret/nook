use super::wasm_bindgen;
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn default_github_repo() -> String {
    nook_core::DEFAULT_GITHUB_REPO_NAME.to_owned()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn wasm_storage_mode_for_provider(
    kind: &tsify::Ts<nook_core::ProviderKind>,
) -> Result<String, wasm_bindgen::JsError> {
    let kind = kind
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    Ok(kind.storage_mode().as_str().to_owned())
}

/// The label a row of `kind` takes from a detail: a folder name, a
/// repository, or an S3 location.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_default_label(
    kind: &tsify::Ts<nook_core::ProviderKind>,
    detail: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let kind = kind
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    Ok(kind.label_with_detail(detail))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_default_label_without_detail(
    kind: &tsify::Ts<nook_core::ProviderKind>,
) -> Result<String, wasm_bindgen::JsError> {
    let kind = kind
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    Ok(kind.bare_label())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{OAuthFilePreset, ProviderKind};
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn provider_label_exports_cover_modes_and_details() -> Result<(), wasm_bindgen::JsError> {
        assert_eq!(default_github_repo(), "nook");
        let icloud = Tsify::into_ts(&ProviderKind::OauthFile(OAuthFilePreset::ICloud))?;
        assert_eq!(wasm_storage_mode_for_provider(&icloud)?, "icloud");
        assert_eq!(provider_default_label(&icloud, "ignored")?, "iCloud");
        let folder = Tsify::into_ts(&ProviderKind::LocalFolder)?;
        assert_eq!(
            provider_default_label(&folder, " backups ")?,
            "Local backup · backups"
        );
        assert_eq!(
            provider_default_label_without_detail(&folder)?,
            "Local backup"
        );
        let github = Tsify::into_ts(&ProviderKind::Github)?;
        assert_eq!(wasm_storage_mode_for_provider(&github)?, "github");
        assert_eq!(provider_default_label(&github, " repo ")?, "GitHub · repo");
        Ok(())
    }
}
