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
