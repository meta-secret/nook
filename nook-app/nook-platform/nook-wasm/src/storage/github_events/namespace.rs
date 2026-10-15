//! Deleting one event-log namespace (a vault deleted everywhere) from a
//! GitHub repository in a single commit. A branch that moved in between
//! fails the ref update instead of being overwritten.

use reqwest::{Client, Method, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::GitHubEventStore;
use crate::NookError;

#[derive(Deserialize)]
struct RepoInfo {
    default_branch: String,
}

#[derive(Deserialize)]
struct ShaObject {
    sha: String,
}

#[derive(Deserialize)]
struct BranchRef {
    object: ShaObject,
}

#[derive(Deserialize)]
struct CommitInfo {
    tree: ShaObject,
}

#[derive(Deserialize)]
struct TreeItem {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct TreeListing {
    tree: Vec<TreeItem>,
    truncated: bool,
}

/// A tree entry whose `sha` is null removes that path from the base tree.
#[derive(Serialize)]
struct PathRemoval<'a> {
    path: &'a str,
    mode: &'static str,
    #[serde(rename = "type")]
    kind: &'static str,
    sha: Option<&'a str>,
}

#[derive(Serialize)]
struct TreeWrite<'a> {
    base_tree: &'a str,
    tree: Vec<PathRemoval<'a>>,
}

#[derive(Serialize)]
struct CommitWrite<'a> {
    message: &'a str,
    tree: &'a str,
    parents: [&'a str; 1],
}

#[derive(Serialize)]
struct RefMove<'a> {
    sha: &'a str,
    force: bool,
}

/// Named values required by `GitHubEventStore::github_api`.
struct GitHubCall<'a> {
    client: &'a Client,
    method: Method,
    path: &'a str,
}

impl GitHubEventStore<'_> {
    fn github_api(&self, call: GitHubCall<'_>) -> RequestBuilder {
        let GitHubCall {
            client,
            method,
            path,
        } = call;
        client
            .request(
                method,
                format!("https://api.github.com/repos/{}/{path}", self.repo),
            )
            .header("Authorization", format!("Bearer {}", self.pat.trim()))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
    }

    async fn github_json<T: DeserializeOwned>(request: RequestBuilder) -> Result<T, NookError> {
        let response = request.send().await?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        if !status.is_success() {
            return Err(NookError::GitHub(format!(
                "GitHub namespace deletion failed with status {status}"
            )));
        }
        serde_json::from_str(&text).map_err(|e| NookError::Serialization(e.to_string()))
    }

    /// Paths under this namespace's root among the tree's blobs.
    fn namespace_paths<'a>(items: &'a [TreeItem], root: &str) -> Vec<&'a str> {
        let prefix = format!("{root}/");
        items
            .iter()
            .filter(|item| item.kind == "blob" && item.path.starts_with(&prefix))
            .map(|item| item.path.as_str())
            .collect()
    }

    /// Delete every file of this namespace in one commit. Returns how many
    /// went; nothing to do when the namespace holds none.
    pub(crate) async fn delete_github_namespace(&self) -> Result<usize, NookError> {
        let client = Client::new();
        let repo: RepoInfo = Self::github_json(self.github_api(GitHubCall {
            client: &client,
            method: Method::GET,
            path: "",
        }))
        .await?;
        let branch = urlencoding::encode(&repo.default_branch).into_owned();
        let head: BranchRef = Self::github_json(self.github_api(GitHubCall {
            client: &client,
            method: Method::GET,
            path: &format!("git/ref/heads/{branch}"),
        }))
        .await?;
        let commit: CommitInfo = Self::github_json(self.github_api(GitHubCall {
            client: &client,
            method: Method::GET,
            path: &format!("git/commits/{}", head.object.sha),
        }))
        .await?;
        let listing: TreeListing = Self::github_json(self.github_api(GitHubCall {
            client: &client,
            method: Method::GET,
            path: &format!("git/trees/{}?recursive=1", commit.tree.sha),
        }))
        .await?;
        if listing.truncated {
            return Err(NookError::GitHub(
                "GitHub tree listing was truncated; nothing was deleted.".to_owned(),
            ));
        }
        let root = self.location.root();
        let paths = Self::namespace_paths(&listing.tree, &root);
        if paths.is_empty() {
            return Ok(0);
        }
        let tree: ShaObject = Self::github_json(
            self.github_api(GitHubCall {
                client: &client,
                method: Method::POST,
                path: "git/trees",
            })
            .json(&TreeWrite {
                base_tree: &commit.tree.sha,
                tree: paths
                    .iter()
                    .map(|path| PathRemoval {
                        path,
                        mode: "100644",
                        kind: "blob",
                        sha: None,
                    })
                    .collect(),
            }),
        )
        .await?;
        let message = format!("Delete {root}");
        let new_commit: ShaObject = Self::github_json(
            self.github_api(GitHubCall {
                client: &client,
                method: Method::POST,
                path: "git/commits",
            })
            .json(&CommitWrite {
                message: &message,
                tree: &tree.sha,
                parents: [&head.object.sha],
            }),
        )
        .await?;
        let _moved: BranchRef = Self::github_json(
            self.github_api(GitHubCall {
                client: &client,
                method: Method::PATCH,
                path: &format!("git/refs/heads/{branch}"),
            })
            .json(&RefMove {
                sha: &new_commit.sha,
                force: false,
            }),
        )
        .await?;
        Ok(paths.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn item(path: &str, kind: &str) -> TreeItem {
        TreeItem {
            path: path.to_owned(),
            kind: kind.to_owned(),
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn only_the_namespace_blobs_are_deleted() {
        let items = [
            item("nook-log/v1/vaults/store_drop/events/a.yaml", "blob"),
            item("nook-log/v1/vaults/store_drop/events/b.yaml", "blob"),
            item("nook-log/v1/vaults/store_drop/events", "tree"),
            item("nook-log/v1/vaults/store_dropped/events/c.yaml", "blob"),
            item("nook-log/v1/vaults/store_keep/events/d.yaml", "blob"),
            item("nook-identity/v1/idn_x/events/e.yaml", "blob"),
        ];
        assert_eq!(
            GitHubEventStore::namespace_paths(&items, "nook-log/v1/vaults/store_drop/events"),
            vec![
                "nook-log/v1/vaults/store_drop/events/a.yaml",
                "nook-log/v1/vaults/store_drop/events/b.yaml",
            ]
        );
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn a_removal_entry_serializes_a_null_sha() -> anyhow::Result<()> {
        let removal = PathRemoval {
            path: "nook-log/v1/vaults/store_drop/events/a.yaml",
            mode: "100644",
            kind: "blob",
            sha: None,
        };
        let json = serde_json::to_value(&removal)?;
        assert!(json.get("sha").is_some_and(serde_json::Value::is_null));
        assert_eq!(json.get("type"), Some(&serde_json::json!("blob")));
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod fetch_tests {
    use super::*;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use nook_core::{EventLogLocation, EventLogNamespaceKind, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;

    const REPO: &str = "repos/owner/repo";

    fn location() -> anyhow::Result<EventLogLocation> {
        Ok(EventLogLocation::Vault(StoreId::parse(
            "store_abcdefghijk",
        )?))
    }

    fn head_routes(tree: &str) -> Vec<FetchRoute> {
        vec![
            FetchRoute::ok(
                "GET",
                "git/ref/heads/main",
                r#"{"object":{"sha":"head-sha"}}"#,
            ),
            FetchRoute::ok(
                "GET",
                "git/commits/head-sha",
                r#"{"tree":{"sha":"tree-sha"}}"#,
            ),
            FetchRoute::ok("GET", "git/trees/tree-sha?recursive=1", tree),
            FetchRoute::ok("GET", REPO, r#"{"default_branch":"main"}"#),
        ]
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn deleting_a_namespace_commits_its_removal_once() -> anyhow::Result<()> {
        let location = location()?;
        let tree = r#"{"truncated":false,"tree":[
            {"path":"nook-log/v1/vaults/store_abcdefghijk/events/a.yaml","type":"blob"},
            {"path":"nook-log/v1/vaults/store_abcdefghijk/events/b.yaml","type":"blob"},
            {"path":"nook-log/v1/vaults/store_keep/events/c.yaml","type":"blob"}
        ]}"#;
        let mut routes = head_routes(tree);
        routes.extend([
            FetchRoute::ok("POST", "git/trees", r#"{"sha":"new-tree"}"#),
            FetchRoute::ok("POST", "git/commits", r#"{"sha":"new-commit"}"#),
            FetchRoute::ok(
                "PATCH",
                "git/refs/heads/main",
                r#"{"object":{"sha":"new-commit"}}"#,
            ),
        ]);
        let stub = FetchStub::install(routes)?;
        let deleted = GitHubEventStore {
            pat: " pat ",
            repo: "owner/repo",
            location: &location,
        }
        .delete_github_namespace()
        .await?;
        assert_eq!(deleted, 2);
        let calls = stub.calls();
        assert_eq!(calls.len(), 7);
        assert!(calls[6].starts_with("PATCH"));
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
    async fn empty_truncated_or_failed_namespaces_write_nothing() -> anyhow::Result<()> {
        let location = location()?;
        let store = GitHubEventStore {
            pat: "pat",
            repo: "owner/repo",
            location: &location,
        };
        let stub = FetchStub::install(head_routes(r#"{"truncated":false,"tree":[]}"#))?;
        assert_eq!(store.delete_github_namespace().await?, 0);
        assert!(stub.calls().iter().all(|call| call.starts_with("GET")));
        drop(stub);

        let stub = FetchStub::install(head_routes(r#"{"truncated":true,"tree":[]}"#))?;
        assert!(store.delete_github_namespace().await.is_err());
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::failing("GET", REPO, 401)])?;
        assert!(store.delete_github_namespace().await.is_err());
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
    async fn namespace_ids_come_from_the_default_branch_tree() -> anyhow::Result<()> {
        let stub = FetchStub::install(vec![
            FetchRoute::ok(
                "GET",
                "git/trees/main?recursive=1",
                r#"{"truncated":false,"tree":[
                    {"path":"nook-log/v1/vaults/store_b/events/x.yaml","type":"blob"},
                    {"path":"nook-log/v1/vaults/store_a/events/y.yaml","type":"blob"},
                    {"path":"nook-log/v1/vaults/store_a/events/z.yaml","type":"blob"},
                    {"path":"nook-log/v1/vaults/store_a/events","type":"tree"}
                ]}"#,
            ),
            FetchRoute::ok("GET", REPO, r#"{"default_branch":"main"}"#),
        ])?;
        let ids = GitHubEventStore::list_github_namespace_ids(
            "pat",
            "owner/repo",
            EventLogNamespaceKind::Vault,
        )
        .await?;
        assert_eq!(ids, ["store_a", "store_b"]);
        assert_eq!(stub.calls().len(), 2);
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::failing("GET", REPO, 404)])?;
        assert!(
            GitHubEventStore::list_github_namespace_ids(
                "pat",
                "owner/repo",
                EventLogNamespaceKind::Identity,
            )
            .await?
            .is_empty()
        );
        Ok(())
    }
}
