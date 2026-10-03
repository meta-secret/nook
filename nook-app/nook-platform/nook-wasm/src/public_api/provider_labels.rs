use super::wasm_bindgen;
use nook_core::DriveBackupName;
use nook_core::{
    OAuthProviderLabel, OauthFilePreset, ProviderLabel, ProviderOauthPreset, StorageProviderType,
    StoredGithubRepository, StoredLocalFolderDirectory, StoredOAuthRemoteFileName,
};
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn default_github_repo() -> String {
    nook_core::DEFAULT_GITHUB_REPO_NAME.to_owned()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn default_drive_backup_name() -> String {
    nook_core::DEFAULT_DRIVE_BACKUP_NAME.to_owned()
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn format_drive_storage_ref(file_id: &str, file_name: &str) -> String {
    DriveBackupName::format_storage_ref_raw(file_id, file_name)
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn format_new_drive_storage_ref(file_name: &str) -> String {
    DriveBackupName::format_storage_ref_raw("", file_name)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn wasm_storage_mode_for_provider(
    provider_type: &tsify::Ts<nook_core::StorageProviderType>,
    oauth_preset: &tsify::Ts<nook_core::OauthFilePreset>,
) -> Result<String, wasm_bindgen::JsError> {
    let oauth_preset = oauth_preset
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let provider_type = provider_type
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    Ok(provider_type
        .storage_mode(ProviderOauthPreset::Preset(oauth_preset))
        .as_str()
        .to_owned())
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_default_label(
    provider_type: &tsify::Ts<nook_core::StorageProviderType>,

    detail: &str,
    oauth_preset: &tsify::Ts<nook_core::OauthFilePreset>,
) -> Result<String, wasm_bindgen::JsError> {
    let oauth_preset = oauth_preset
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let provider_type = provider_type
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    Ok(match provider_type {
        StorageProviderType::Local => ProviderLabel::Local.render(),
        StorageProviderType::LocalFolder => ProviderLabel::LocalFolder(
            &StoredLocalFolderDirectory::DirectoryName(detail.to_owned()),
        )
        .render(),
        StorageProviderType::Github => {
            ProviderLabel::Github(&StoredGithubRepository::Repository(detail.to_owned())).render()
        }
        StorageProviderType::OauthFile => ProviderLabel::OAuth(OAuthProviderLabel {
            preset: oauth_preset,
            file_name: &StoredOAuthRemoteFileName::FileName(detail.to_owned()),
        })
        .render(),
    })
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn provider_default_label_without_detail(
    provider_type: &tsify::Ts<nook_core::StorageProviderType>,
    oauth_preset: &tsify::Ts<nook_core::OauthFilePreset>,
) -> Result<String, wasm_bindgen::JsError> {
    let oauth_preset = oauth_preset
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;

    let provider_type = provider_type
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    Ok(match provider_type {
        StorageProviderType::Local => ProviderLabel::Local.render(),
        StorageProviderType::LocalFolder => {
            ProviderLabel::LocalFolder(&StoredLocalFolderDirectory::Unnamed).render()
        }
        StorageProviderType::Github => {
            ProviderLabel::Github(&StoredGithubRepository::DefaultRepository).render()
        }
        StorageProviderType::OauthFile => ProviderLabel::OAuth(OAuthProviderLabel {
            preset: oauth_preset,
            file_name: &StoredOAuthRemoteFileName::Unresolved,
        })
        .render(),
    })
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn staged_local_provider_label(
    provider_type: &tsify::Ts<nook_core::StorageProviderType>,
) -> Result<String, wasm_bindgen::JsError> {
    let provider_type = provider_type
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    Ok(match provider_type {
        StorageProviderType::Local => ProviderLabel::Local.render(),
        StorageProviderType::LocalFolder => {
            ProviderLabel::LocalFolder(&StoredLocalFolderDirectory::Unnamed).render()
        }
        StorageProviderType::Github => {
            ProviderLabel::Github(&StoredGithubRepository::DefaultRepository).render()
        }
        StorageProviderType::OauthFile => ProviderLabel::OAuth(OAuthProviderLabel {
            preset: OauthFilePreset::GoogleDrive,
            file_name: &StoredOAuthRemoteFileName::Unresolved,
        })
        .render(),
    })
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_github_provider_label(github_repo: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(ProviderLabel::Github(&StoredGithubRepository::Repository(github_repo.to_owned())).render())
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_configured_oauth_provider_label(oauth_file_name: &str,
oauth_preset: &tsify::Ts<nook_core::OauthFilePreset>) -> Result<String, wasm_bindgen::JsError> {
let oauth_preset = oauth_preset.to_rust().map_err(|_| JsError::new("Invalid typed WASM input."))?;

    Ok(ProviderLabel::OAuth(OAuthProviderLabel {
        preset: oauth_preset,
        file_name: &StoredOAuthRemoteFileName::FileName(oauth_file_name.to_owned()),
    })
    .render())

}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn staged_unconfigured_oauth_provider_label() -> Result<String, wasm_bindgen::JsError> {
    Ok(ProviderLabel::OAuth(OAuthProviderLabel {
        preset: OauthFilePreset::GoogleDrive,
        file_name: &StoredOAuthRemoteFileName::Unresolved,
    })
    .render())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::OauthFilePreset;
    #[cfg(test)]
    use tsify::Tsify;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn provider_label_exports_cover_defaults_and_details() -> Result<(), wasm_bindgen::JsError> {
        assert_eq!(default_github_repo(), "nook");
        assert_eq!(default_drive_backup_name(), "nook-events");
        assert_eq!(
            format_drive_storage_ref(" file-id ", " events.json "),
            "file-id\tevents.json"
        );
        assert_eq!(format_new_drive_storage_ref(""), "nook-events");

        assert_eq!(
            wasm_storage_mode_for_provider(
                &Tsify::into_ts(&(StorageProviderType::Local))?,
                &Tsify::into_ts(&(OauthFilePreset::ICloud))?
            )?,
            "local"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                &Tsify::into_ts(&(StorageProviderType::Github))?,
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "github"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                &Tsify::into_ts(&(StorageProviderType::OauthFile))?,
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "google-drive"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                &Tsify::into_ts(&(StorageProviderType::OauthFile))?,
                &Tsify::into_ts(&(OauthFilePreset::ICloud))?
            )?,
            "icloud"
        );

        assert_eq!(
            provider_default_label(
                &Tsify::into_ts(&(StorageProviderType::Local))?,
                "ignored",
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "This device"
        );
        assert_eq!(
            provider_default_label(
                &Tsify::into_ts(&(StorageProviderType::LocalFolder))?,
                " backups ",
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "Local backup · backups"
        );
        assert_eq!(
            provider_default_label(
                &Tsify::into_ts(&(StorageProviderType::Github))?,
                " repo ",
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "GitHub · repo"
        );
        assert_eq!(
            provider_default_label(
                &Tsify::into_ts(&(StorageProviderType::OauthFile))?,
                " vault.json ",
                &Tsify::into_ts(&(OauthFilePreset::ICloud))?
            )?,
            "iCloud · vault.json"
        );
        assert_eq!(
            provider_default_label_without_detail(
                &Tsify::into_ts(&(StorageProviderType::OauthFile))?,
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "Google Drive"
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn staged_provider_labels_use_their_provider_specific_defaults()
    -> Result<(), wasm_bindgen::JsError> {
        assert_eq!(
            staged_local_provider_label(&Tsify::into_ts(&(StorageProviderType::Local))?)?,
            "This device"
        );
        assert_eq!(
            staged_local_provider_label(&Tsify::into_ts(&(StorageProviderType::LocalFolder))?)?,
            "Local backup"
        );
        assert_eq!(staged_github_provider_label(" nook ")?, "GitHub");
        assert_eq!(
            staged_github_provider_label("team-vault")?,
            "GitHub · team-vault"
        );
        assert_eq!(
            staged_configured_oauth_provider_label(
                "events.json",
                &Tsify::into_ts(&(OauthFilePreset::GoogleDrive))?
            )?,
            "Google Drive · events.json"
        );
        assert_eq!(staged_unconfigured_oauth_provider_label()?, "Google Drive");
        Ok(())
    }
}
