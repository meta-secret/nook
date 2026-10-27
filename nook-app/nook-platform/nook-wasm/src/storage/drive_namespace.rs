//! Google Drive folders that mirror the provider layout: under the root, one
//! folder per identity, holding its control log in `log` and each vault it
//! filed in a folder named by the store id.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{DriveEventParent, EventLogNamespaceKind, IdentityId, PlacedNamespace};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::drive::wire::CreatedTime;
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
    #[serde(default)]
    created_time: CreatedTime,
}

/// One namespace folder listed under a provider's root.
pub(crate) struct ListedNamespaceFolder {
    pub(crate) placed: PlacedNamespace,
    pub(crate) folder: DriveEventParent,
    pub(crate) created: CreatedTime,
}

impl ListedNamespaceFolder {
    /// The vault this folder holds, when it is a vault's.
    pub(crate) fn store_id(&self) -> Option<&nook_core::StoreId> {
        match self.placed.location() {
            nook_core::EventLogLocation::Vault(store_id) => Some(store_id),
            nook_core::EventLogLocation::Identity(_) => None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolderMetadata<'a> {
    name: &'a str,
    mime_type: &'a str,
    parents: [&'a str; 1],
}

/// Which folders one lookup lists: every child folder of `parent`, or only
/// the one with this name.
enum FolderQuery<'a> {
    Children,
    Named(&'a str),
}

/// Named values required by `DriveNamespace::folders`.
struct FolderLookup<'a> {
    token: &'a str,
    parent: &'a DriveEventParent,
    query: FolderQuery<'a>,
}

/// Resolve the Drive folder that holds one placed namespace's events.
pub(crate) struct DriveNamespace<'a> {
    pub(crate) token: &'a str,
    /// The provider's root folder.
    pub(crate) parent: &'a DriveEventParent,
    pub(crate) placed: &'a PlacedNamespace,
}

impl DriveNamespace<'_> {
    fn parent_id(parent: &DriveEventParent) -> &str {
        parent.folder_id.as_str()
    }

    fn child_parent(folder_id: String) -> DriveEventParent {
        DriveEventParent { folder_id }
    }

    fn escape(value: &str) -> String {
        value.replace('\\', "\\\\").replace('\'', "\\'")
    }

    fn query(parent: &DriveEventParent, query: &FolderQuery<'_>) -> String {
        let escaped_parent = Self::escape(Self::parent_id(parent));
        let scope = format!(
            "mimeType = '{DRIVE_FOLDER_MIME_TYPE}' and '{escaped_parent}' in parents and trashed = false"
        );
        match query {
            FolderQuery::Children => scope,
            FolderQuery::Named(name) => format!("name = '{}' and {scope}", Self::escape(name)),
        }
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

    /// The child folders of one parent, across pages.
    async fn folders(lookup: FolderLookup<'_>) -> Result<Vec<NamespaceFolder>, NookError> {
        let FolderLookup {
            token,
            parent,
            query,
        } = lookup;
        let client = Client::new();
        let q = Self::query(parent, &query);
        let mut page_token: Option<String> = None;
        let mut folders = Vec::new();
        loop {
            let mut request = client
                .get("https://www.googleapis.com/drive/v3/files")
                .header("Authorization", format!("Bearer {}", token.trim()))
                .query(&[
                    ("q", q.as_str()),
                    (
                        "fields",
                        "nextPageToken,files(id,name,mimeType,createdTime)",
                    ),
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
                folder.mime_type == DRIVE_FOLDER_MIME_TYPE
                    && match query {
                        FolderQuery::Children => true,
                        FolderQuery::Named(name) => folder.name == name,
                    }
            }));
            page_token = body.next_page_token;
            if page_token.is_none() {
                return Ok(folders);
            }
        }
    }

    async fn create(&self, parent: &DriveEventParent, name: &str) -> Result<String, NookError> {
        let response = Client::new()
            .post("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {}", self.token.trim()))
            .header("User-Agent", "nook-wasm")
            .json(&NamespaceFolderMetadata {
                name,
                mime_type: DRIVE_FOLDER_MIME_TYPE,
                parents: [Self::parent_id(parent)],
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

    /// The one folder named `name` in `parent`; a duplicate fails closed.
    async fn existing(
        &self,
        parent: &DriveEventParent,
        name: &str,
    ) -> Result<Option<DriveEventParent>, NookError> {
        let folders = Self::folders(FolderLookup {
            token: self.token,
            parent,
            query: FolderQuery::Named(name),
        })
        .await?;
        Ok(Self::select(&folders)?.map(Self::child_parent))
    }

    /// The one folder named `name` in `parent`, created when missing.
    async fn ensure(
        &self,
        parent: &DriveEventParent,
        name: &str,
    ) -> Result<DriveEventParent, NookError> {
        if let Some(folder) = self.existing(parent, name).await? {
            return Ok(folder);
        }
        let created = self.create(parent, name).await?;
        // A second lookup catches a concurrent creation before any write picks
        // one of two ambiguous parents.
        Ok(self
            .existing(parent, name)
            .await?
            .unwrap_or_else(|| Self::child_parent(created)))
    }

    /// Every namespace of one kind under the root, each with its folder and
    /// the time Drive created it.
    pub(crate) async fn list_folders(
        token: &str,
        root: &DriveEventParent,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<ListedNamespaceFolder>, NookError> {
        let identities = Self::folders(FolderLookup {
            token,
            parent: root,
            query: FolderQuery::Children,
        })
        .await?;
        let mut listed = Vec::new();
        for identity in identities {
            if IdentityId::parse(&identity.name)
                .ok()
                .is_none_or(|id| id.as_str() != identity.name)
            {
                continue;
            }
            let identity_folder = Self::child_parent(identity.id.trim().to_owned());
            for folder in Self::folders(FolderLookup {
                token,
                parent: &identity_folder,
                query: FolderQuery::Children,
            })
            .await?
            {
                let Some(placed) = PlacedNamespace::from_folders(&identity.name, &folder.name)
                else {
                    continue;
                };
                let folder_id = folder.id.trim();
                if placed.location().kind() == kind && !folder_id.is_empty() {
                    listed.push(ListedNamespaceFolder {
                        placed,
                        folder: Self::child_parent(folder_id.to_owned()),
                        created: folder.created_time,
                    });
                }
            }
        }
        listed.sort_by(|left, right| left.placed.cmp(&right.placed));
        Ok(listed)
    }

    /// Every namespace of one kind under the root.
    pub(crate) async fn list_placed(
        token: &str,
        root: &DriveEventParent,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        Ok(Self::list_folders(token, root, kind)
            .await?
            .into_iter()
            .map(|folder| folder.placed)
            .collect())
    }

    /// Delete this namespace's folder and every event in it (a vault deleted
    /// everywhere). Nothing to do when the folder does not exist; a duplicate
    /// fails closed.
    pub(crate) async fn delete(&self) -> Result<bool, NookError> {
        let Some(identity_folder) = self
            .existing(self.parent, self.placed.identity().as_str())
            .await?
        else {
            return Ok(false);
        };
        let Some(folder) = self
            .existing(&identity_folder, self.placed.folder_name())
            .await?
        else {
            return Ok(false);
        };
        let response = Client::new()
            .delete(format!(
                "https://www.googleapis.com/drive/v3/files/{}",
                urlencoding::encode(&folder.folder_id)
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

    /// Resolve or create the namespace's folder inside its identity's folder;
    /// a duplicate at either level fails closed.
    pub(crate) async fn resolve(&self) -> Result<DriveEventParent, NookError> {
        let identity_folder = self
            .ensure(self.parent, self.placed.identity().as_str())
            .await?;
        self.ensure(&identity_folder, self.placed.folder_name())
            .await
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
        let shared = DriveEventParent::shared_folder_id("shared-root");
        assert_eq!(
            DriveNamespace::child_parent("child".to_owned()),
            DriveEventParent::shared_folder_id("child")
        );
        assert_eq!(
            DriveNamespace::query(&shared, &FolderQuery::Named("nook-o'neil")),
            "name = 'nook-o\\'neil' and mimeType = 'application/vnd.google-apps.folder' and 'shared-root' in parents and trashed = false"
        );
        assert_eq!(
            DriveNamespace::query(&shared, &FolderQuery::Children),
            "mimeType = 'application/vnd.google-apps.folder' and 'shared-root' in parents and trashed = false"
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
    const IDENTITY: &str = "idn_abcdefghijk";
    const STORE: &str = "store_abcdefghijk";

    fn placed() -> anyhow::Result<PlacedNamespace> {
        Ok(PlacedNamespace::vault(
            IdentityId::parse(IDENTITY)?,
            StoreId::parse(STORE)?,
        ))
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
    async fn resolve_reuses_the_identity_and_vault_folders_across_pages() -> anyhow::Result<()> {
        let placed = placed()?;
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok("GET", LIST, r#"{"files":[],"nextPageToken":"page-2"}"#),
            FetchRoute::ok("GET", LIST, &listing(&[folder("existing", STORE)])),
        ])?;
        let resolved = DriveNamespace {
            token: "drive-token",
            parent: &DriveEventParent::shared_folder_id("root-folder"),
            placed: &placed,
        }
        .resolve()
        .await?;
        assert_eq!(resolved, DriveEventParent::shared_folder_id("existing"));
        let calls = stub.calls();
        assert_eq!(calls.len(), 3);
        // The identity folder is looked up in the root, the vault in it.
        assert!(calls[0].contains("root-folder"));
        assert!(calls[1].contains("identity"));
        assert!(calls[2].contains("pageToken=page-2"));
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
    async fn resolve_creates_missing_folders_and_rechecks_them() -> anyhow::Result<()> {
        let placed = placed()?;
        let root = DriveEventParent::shared_folder_id("root-folder");
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[])),
            FetchRoute::ok("POST", FILES, &folder("identity", IDENTITY)),
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok("GET", LIST, &listing(&[])),
            FetchRoute::ok("POST", FILES, &folder("created", STORE)),
            FetchRoute::ok("GET", LIST, &listing(&[])),
        ])?;
        let resolved = DriveNamespace {
            token: "drive-token",
            parent: &root,
            placed: &placed,
        }
        .resolve()
        .await?;
        assert_eq!(resolved, DriveEventParent::shared_folder_id("created"));
        assert_eq!(stub.calls().len(), 6);

        drop(stub);
        let _stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok("GET", LIST, &listing(&[])),
            FetchRoute::ok("POST", FILES, &folder("created", "another-name")),
        ])?;
        assert!(
            DriveNamespace {
                token: "drive-token",
                parent: &root,
                placed: &placed,
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
        let placed = placed()?;
        let namespace = DriveNamespace {
            token: "drive-token",
            parent: &DriveEventParent::shared_folder_id("root-folder"),
            placed: &placed,
        };
        let stub = FetchStub::install(vec![FetchRoute::ok(
            "GET",
            LIST,
            &listing(&[folder("one", IDENTITY), folder("two", IDENTITY)]),
        )])?;
        assert!(namespace.resolve().await.is_err());
        drop(stub);
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok(
                "GET",
                LIST,
                &listing(&[folder("one", STORE), folder("two", STORE)]),
            ),
        ])?;
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
    async fn listing_walks_each_identity_folder() -> anyhow::Result<()> {
        let routes = || {
            vec![
                FetchRoute::ok(
                    "GET",
                    LIST,
                    &listing(&[
                        folder("ia", "idn_aaaaaaaaaaa"),
                        folder("ib", "idn_bbbbbbbbbbb"),
                        folder("notes", "notes"),
                    ]),
                ),
                FetchRoute::ok(
                    "GET",
                    LIST,
                    &listing(&[folder("va", "store_aaaaaaaaaaa"), folder("la", "log")]),
                ),
                FetchRoute::ok(
                    "GET",
                    LIST,
                    &listing(&[
                        folder("vb", "store_bbbbbbbbbbb"),
                        folder("junk", "not-a-store"),
                    ]),
                ),
            ]
        };
        let root = DriveEventParent::shared_folder_id("root-folder");
        let first = IdentityId::parse("idn_aaaaaaaaaaa")?;
        let second = IdentityId::parse("idn_bbbbbbbbbbb")?;

        let stub = FetchStub::install(routes())?;
        let vaults =
            DriveNamespace::list_placed("drive-token", &root, EventLogNamespaceKind::Vault).await?;
        assert_eq!(
            vaults,
            [
                PlacedNamespace::vault(first.clone(), StoreId::parse("store_aaaaaaaaaaa")?),
                PlacedNamespace::vault(second, StoreId::parse("store_bbbbbbbbbbb")?),
            ]
        );
        // A folder that names no identity is never opened.
        assert_eq!(stub.calls().len(), 3);
        drop(stub);

        let stub = FetchStub::install(routes())?;
        assert_eq!(
            DriveNamespace::list_placed("drive-token", &root, EventLogNamespaceKind::Identity)
                .await?,
            [PlacedNamespace::identity_log(first)]
        );
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::failing("GET", LIST, 401)])?;
        assert!(
            DriveNamespace::list_placed("drive-token", &root, EventLogNamespaceKind::Vault)
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
        let placed = placed()?;
        let namespace = DriveNamespace {
            token: "drive-token",
            parent: &DriveEventParent::shared_folder_id("root-folder"),
            placed: &placed,
        };
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok("GET", LIST, &listing(&[folder("doomed", STORE)])),
            FetchRoute::ok("DELETE", "drive/v3/files/doomed", ""),
        ])?;
        assert!(namespace.delete().await?);
        assert!(stub.calls()[2].starts_with("DELETE"));
        drop(stub);

        // Nothing to delete without the identity folder or the vault folder.
        let stub = FetchStub::install(vec![FetchRoute::ok("GET", LIST, &listing(&[]))])?;
        assert!(!namespace.delete().await?);
        drop(stub);
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok("GET", LIST, &listing(&[])),
        ])?;
        assert!(!namespace.delete().await?);
        drop(stub);

        let _stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &listing(&[folder("identity", IDENTITY)])),
            FetchRoute::ok("GET", LIST, &listing(&[folder("doomed", STORE)])),
            FetchRoute::failing("DELETE", "drive/v3/files/doomed", 500),
        ])?;
        assert!(namespace.delete().await.is_err());
        Ok(())
    }
}
