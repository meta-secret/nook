//! Google Drive child folders that separate event-log namespaces.
//!
//! The identity log and every vault live in their own folder under the
//! provider's event parent.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{DriveEventParent, EventLogLocation, EventLogNamespaceKind};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::NookError;

const DRIVE_FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolderList {
    #[serde(default)]
    files: Vec<NamespaceFolder>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolder {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolderMetadata<'a> {
    name: &'a str,
    mime_type: &'a str,
    parents: [&'a str; 1],
}

/// Resolve the Drive event parent that holds one event-log namespace.
pub(crate) struct DriveNamespace<'a> {
    pub(crate) token: &'a str,
    pub(crate) parent: &'a DriveEventParent,
    pub(crate) location: &'a EventLogLocation,
}

impl DriveNamespace<'_> {
    fn folder_name(tag: &str) -> String {
        format!("nook-{}", tag.replace(':', "-"))
    }

    fn parent_id(parent: &DriveEventParent) -> &str {
        parent.folder_id.as_str()
    }

    fn child_parent(folder_id: String) -> DriveEventParent {
        DriveEventParent { folder_id }
    }

    fn query(parent: &DriveEventParent, name: &str) -> String {
        let escaped_name = name.replace('\\', "\\\\").replace('\'', "\\'");
        let escaped_parent = Self::parent_id(parent).replace('\'', "\\'");
        format!(
            "name = '{escaped_name}' and mimeType = '{DRIVE_FOLDER_MIME_TYPE}' and '{escaped_parent}' in parents and trashed = false"
        )
    }

    fn select(folders: &[NamespaceFolder]) -> Result<Option<String>, NookError> {
        match folders {
            [] => Ok(None),
            [folder] if !folder.id.trim().is_empty() => Ok(Some(folder.id.trim().to_owned())),
            [_] => Err(NookError::Drive(
                "Google Drive namespace folder is missing its ID.".to_owned(),
            )),
            _ => Err(NookError::Drive(
                "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                    .to_owned(),
            )),
        }
    }

    async fn list(&self, name: &str) -> Result<Vec<NamespaceFolder>, NookError> {
        let client = Client::new();
        let query = Self::query(self.parent, name);
        let mut page_token: Option<String> = None;
        let mut folders = Vec::new();
        loop {
            let mut request = client
                .get("https://www.googleapis.com/drive/v3/files")
                .header("Authorization", format!("Bearer {}", self.token.trim()))
                .query(&[
                    ("q", query.as_str()),
                    ("fields", "nextPageToken,files(id,name,mimeType)"),
                    ("pageSize", "1000"),
                ]);
            if let Some(page) = page_token.as_deref() {
                request = request.query(&[("pageToken", page)]);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                return Err(NookError::Drive(format!(
                    "Google Drive namespace lookup failed with status {}",
                    response.status()
                )));
            }
            let body: NamespaceFolderList = response
                .json()
                .await
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            folders.extend(body.files.into_iter().filter(|folder| {
                folder.name == name && folder.mime_type == DRIVE_FOLDER_MIME_TYPE
            }));
            page_token = body.next_page_token;
            if page_token.is_none() {
                return Ok(folders);
            }
        }
    }

    async fn create(&self, name: &str) -> Result<String, NookError> {
        let response = Client::new()
            .post("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {}", self.token.trim()))
            .header("User-Agent", "nook-wasm")
            .json(&NamespaceFolderMetadata {
                name,
                mime_type: DRIVE_FOLDER_MIME_TYPE,
                parents: [Self::parent_id(self.parent)],
            })
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Google Drive namespace creation failed with status {}",
                response.status()
            )));
        }
        let created: NamespaceFolder = response
            .json()
            .await
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        if created.id.trim().is_empty() || created.name != name {
            return Err(NookError::Drive(
                "Google Drive returned an invalid namespace folder.".to_owned(),
            ));
        }
        Ok(created.id.trim().to_owned())
    }

    /// Ids of every namespace of one kind with a folder under `parent`.
    pub(crate) async fn list_ids(
        token: &str,
        parent: &DriveEventParent,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<String>, NookError> {
        let client = Client::new();
        let escaped_parent = Self::parent_id(parent).replace('\'', "\\'");
        let prefix = Self::folder_name(kind.tag_prefix());
        let query = format!(
            "name contains '{prefix}' and mimeType = '{DRIVE_FOLDER_MIME_TYPE}' and '{escaped_parent}' in parents and trashed = false"
        );
        let request = client
            .get("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {}", token.trim()))
            .query(&[
                ("q", query.as_str()),
                ("fields", "files(id,name,mimeType)"),
                ("pageSize", "1000"),
            ]);
        let response = request.send().await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Google Drive namespace lookup failed with status {}",
                response.status()
            )));
        }
        let body: NamespaceFolderList = response
            .json()
            .await
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let mut ids = body
            .files
            .into_iter()
            .filter_map(|folder| {
                folder
                    .name
                    .strip_prefix(prefix.as_str())
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned)
            })
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    /// Delete this namespace's folder and every event in it (a vault deleted
    /// everywhere). Nothing to do when the folder does not exist; a duplicate
    /// fails closed.
    pub(crate) async fn delete(&self) -> Result<bool, NookError> {
        let tag = self.location.namespace_tag();
        let Some(folder_id) = Self::select(&self.list(&Self::folder_name(&tag)).await?)? else {
            return Ok(false);
        };
        let response = Client::new()
            .delete(format!(
                "https://www.googleapis.com/drive/v3/files/{}",
                urlencoding::encode(&folder_id)
            ))
            .header("Authorization", format!("Bearer {}", self.token.trim()))
            .query(&[("supportsAllDrives", "true")])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Google Drive namespace deletion failed with status {}",
                response.status()
            )));
        }
        Ok(true)
    }

    /// Resolve or create the namespace's one child folder; a duplicate fails
    /// closed.
    pub(crate) async fn resolve(&self) -> Result<DriveEventParent, NookError> {
        let tag = self.location.namespace_tag();
        let name = Self::folder_name(&tag);
        if let Some(folder_id) = Self::select(&self.list(&name).await?)? {
            return Ok(Self::child_parent(folder_id));
        }
        let created = self.create(&name).await?;
        // A second lookup catches a concurrent creation before any write picks
        // one of two ambiguous parents.
        let folder_id = Self::select(&self.list(&name).await?)?.unwrap_or(created);
        Ok(Self::child_parent(folder_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn namespace_folders_stay_inside_their_parent_scope() -> anyhow::Result<()> {
        let identity = nook_core::IdentityId::parse("idn_abcdefghijk")?;
        let tag = EventLogLocation::Identity(identity).namespace_tag();
        assert_eq!(
            DriveNamespace::folder_name(&tag),
            "nook-identity-idn_abcdefghijk"
        );
        let shared = DriveEventParent::shared_folder_id("shared-root");
        assert_eq!(
            DriveNamespace::child_parent("child".to_owned()),
            DriveEventParent::shared_folder_id("child")
        );
        assert_eq!(
            DriveNamespace::query(&shared, "nook-o'neil"),
            "name = 'nook-o\\'neil' and mimeType = 'application/vnd.google-apps.folder' and 'shared-root' in parents and trashed = false"
        );
        assert!(DriveNamespace::select(&[]).is_ok_and(|selected| selected.is_none()));
        let duplicate = [NamespaceFolder::default(), NamespaceFolder::default()];
        assert!(DriveNamespace::select(&duplicate).is_err());
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod fetch_tests {
    use super::*;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use nook_core::StoreId;
    use wasm_bindgen_test::wasm_bindgen_test;

    const FILES: &str = "drive/v3/files";
    const LIST: &str = "drive/v3/files?";

    fn location() -> anyhow::Result<EventLogLocation> {
        Ok(EventLogLocation::Vault(StoreId::parse(
            "store_abcdefghijk",
        )?))
    }

    fn folder(id: &str, name: &str) -> String {
        format!(r#"{{"id":"{id}","name":"{name}","mimeType":"{DRIVE_FOLDER_MIME_TYPE}"}}"#)
    }

    fn listing(folders: &[String]) -> String {
        format!(r#"{{"files":[{}]}}"#, folders.join(","))
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn resolve_reuses_an_existing_folder_across_pages() -> anyhow::Result<()> {
        let location = location()?;
        let name = DriveNamespace::folder_name(&location.namespace_tag());
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, r#"{"files":[],"nextPageToken":"page-2"}"#),
            FetchRoute::ok("GET", LIST, &listing(&[folder("existing", &name)])),
        ])?;
        let resolved = DriveNamespace {
            token: "drive-token",
            parent: &DriveEventParent::shared_folder_id("vault-folder"),
            location: &location,
        }
        .resolve()
        .await?;
        assert_eq!(resolved, DriveEventParent::shared_folder_id("existing"));
        let calls = stub.calls();
        assert_eq!(calls.len(), 2);
        assert!(calls[1].contains("pageToken=page-2"));
        assert!(
            calls
                .iter()
                .all(|call| !call.contains("spaces=appDataFolder"))
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn resolve_creates_a_missing_folder_and_rechecks_it() -> anyhow::Result<()> {
        let location = location()?;
        let name = DriveNamespace::folder_name(&location.namespace_tag());
        let shared = DriveEventParent::shared_folder_id("shared-root");
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[])),
            FetchRoute::ok("POST", FILES, &folder("created", &name)),
            FetchRoute::ok("GET", LIST, &listing(&[])),
        ])?;
        let resolved = DriveNamespace {
            token: "drive-token",
            parent: &shared,
            location: &location,
        }
        .resolve()
        .await?;
        assert_eq!(resolved, DriveEventParent::shared_folder_id("created"));
        assert_eq!(stub.calls().len(), 3);

        drop(stub);
        let _stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[])),
            FetchRoute::ok("POST", FILES, &folder("created", "another-name")),
        ])?;
        assert!(
            DriveNamespace {
                token: "drive-token",
                parent: &shared,
                location: &location,
            }
            .resolve()
            .await
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn duplicate_or_failed_lookups_fail_closed() -> anyhow::Result<()> {
        let location = location()?;
        let name = DriveNamespace::folder_name(&location.namespace_tag());
        let namespace = DriveNamespace {
            token: "drive-token",
            parent: &DriveEventParent::shared_folder_id("vault-folder"),
            location: &location,
        };
        let stub = FetchStub::install(vec![FetchRoute::ok(
            "GET",
            LIST,
            &listing(&[folder("one", &name), folder("two", &name)]),
        )])?;
        assert!(namespace.resolve().await.is_err());
        drop(stub);
        let stub = FetchStub::install(vec![FetchRoute::failing("GET", LIST, 403)])?;
        assert!(namespace.resolve().await.is_err());
        drop(stub);
        let _stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[])),
            FetchRoute::failing("POST", FILES, 500),
        ])?;
        assert!(namespace.resolve().await.is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn list_ids_reads_namespace_folder_names() -> anyhow::Result<()> {
        let stub = FetchStub::install(vec![FetchRoute::ok(
            "GET",
            LIST,
            &listing(&[
                folder("b", "nook-vault-store_b"),
                folder("a", "nook-vault-store_a"),
                folder("dup", "nook-vault-store_a"),
                folder("empty", "nook-vault-"),
                folder("other", "notes"),
            ]),
        )])?;
        let ids = DriveNamespace::list_ids(
            "drive-token",
            &DriveEventParent::shared_folder_id("vault-folder"),
            EventLogNamespaceKind::Vault,
        )
        .await?;
        assert_eq!(ids, ["store_a", "store_b"]);
        assert!(stub.calls()[0].contains("vault-folder"));
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::failing("GET", LIST, 401)])?;
        assert!(
            DriveNamespace::list_ids(
                "drive-token",
                &DriveEventParent::shared_folder_id("vault-folder"),
                EventLogNamespaceKind::Identity,
            )
            .await
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn delete_removes_the_one_namespace_folder() -> anyhow::Result<()> {
        let location = location()?;
        let name = DriveNamespace::folder_name(&location.namespace_tag());
        let namespace = DriveNamespace {
            token: "drive-token",
            parent: &DriveEventParent::shared_folder_id("vault-folder"),
            location: &location,
        };
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("doomed", &name)])),
            FetchRoute::ok("DELETE", "drive/v3/files/doomed", ""),
        ])?;
        assert!(namespace.delete().await?);
        assert!(stub.calls()[1].starts_with("DELETE"));
        drop(stub);

        let stub = FetchStub::install(vec![FetchRoute::ok("GET", LIST, &listing(&[]))])?;
        assert!(!namespace.delete().await?);
        drop(stub);

        let _stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("doomed", &name)])),
            FetchRoute::failing("DELETE", "drive/v3/files/doomed", 500),
        ])?;
        assert!(namespace.delete().await.is_err());
        Ok(())
    }
}
