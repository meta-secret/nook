//! Drive's answers, decoded by what each request asks for: a field the
//! request always gets back is required, and documented absence is a named
//! state.
use serde::Deserialize;

use crate::storage::omittable_list::OmittableList;

/// Boundary conversion: Drive's optional `nextPageToken`, read here as the next page or the end.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(from = "Option<String>")]
pub(crate) enum PageCompletion {
    Continue(String),
    Complete,
}

impl From<Option<String>> for PageCompletion {
    fn from(token: Option<String>) -> Self {
        match token {
            Some(token) => Self::Continue(token),
            None => Self::Complete,
        }
    }
}

/// Which page of a Drive listing a request asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DrivePageRequest {
    FirstPage,
    Continuation(String),
}

impl DrivePageRequest {
    /// The request for the page after one with this completion; the last
    /// page has none.
    pub(crate) fn after(completion: PageCompletion) -> PageAfter {
        match completion {
            PageCompletion::Continue(token) => PageAfter::Next(Self::Continuation(token)),
            PageCompletion::Complete => PageAfter::Done,
        }
    }
}

/// Whether a listing goes on to another page.
pub(crate) enum PageAfter {
    Next(DrivePageRequest),
    Done,
}

/// Drive's `createdTime` for a listed file; a listing that asks for it
/// always gets it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub(crate) struct CreatedTime(String);

impl CreatedTime {
    /// The listed creation time; a value Drive did not format as RFC 3339
    /// fails closed.
    pub(crate) fn provider_time(&self) -> Result<nook_core::ProviderVaultTime, crate::NookError> {
        Ok(nook_core::ProviderVaultTime::Reported {
            at: nook_core::ProviderInstant::parse_rfc3339(&self.0)?,
        })
    }
}

/// One file's id: a lookup with `fields=files(id)` or an upload answer.
#[derive(Debug, Deserialize)]
pub(in crate::storage) struct DriveFileId {
    pub(in crate::storage) id: String,
}

/// A `files.list` page of file ids.
#[derive(Debug, Deserialize)]
pub(in crate::storage) struct DriveFileIds {
    pub(in crate::storage) files: OmittableList<DriveFileId>,
}

/// A folder Drive created: its id and name, which the request asks back.
#[derive(Debug, Deserialize)]
pub(in crate::storage) struct DriveCreatedFolder {
    pub(in crate::storage) id: String,
    pub(in crate::storage) name: String,
}
