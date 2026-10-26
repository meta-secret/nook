#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Browser File System Access adapter for local-folder sync providers.
use crate::NookError;
use gloo_file::{File, futures};
use js_sys::{Array, AsyncIterator, JsString, Object, Reflect};
use nook_core::EventId;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen_futures::JsFuture;
mod handles;
pub(crate) use handles::LocalFolderHandles;
mod event_write;
pub(crate) use event_write::LocalFolderEventWrite;
use handles::{
    ChildLookup, ChildLookupRequest, FolderFailure, FolderMethod, FolderObject, FolderPromise,
};

#[wasm_bindgen]
#[derive(Clone)]
/// The public report exposes folder metadata, not a writable stream.
///
/// ```
/// use nook_wasm::NookLocalFolderConfig;
/// let name: fn(&NookLocalFolderConfig) -> String = NookLocalFolderConfig::directory_name;
/// let handle: fn(&NookLocalFolderConfig) -> String = NookLocalFolderConfig::handle_id;
/// ```
///
/// Callers cannot fabricate the result of folder selection.
///
/// ```compile_fail,E0451
/// use nook_wasm::NookLocalFolderConfig;
/// let fabricated = NookLocalFolderConfig {
///     directory_name: "folder".to_owned(), handle_id: "unobserved".to_owned(),
/// };
/// ```
///
/// Configuration metadata does not expose a stream completion operation.
///
/// ```compile_fail,E0599
/// use nook_wasm::NookLocalFolderConfig;
/// let close = |config: NookLocalFolderConfig| config.close();
/// ```
pub struct NookLocalFolderConfig {
    directory_name: String,
    handle_id: String,
}

#[wasm_bindgen]
impl NookLocalFolderConfig {
    #[wasm_bindgen(getter, js_name = directoryName)]
    #[must_use]
    pub fn directory_name(&self) -> String {
        self.directory_name.clone()
    }

    #[wasm_bindgen(getter, js_name = handleId)]
    #[must_use]
    pub fn handle_id(&self) -> String {
        self.handle_id.clone()
    }
}

pub(crate) struct LocalFolderEventFile {
    pub event_id: String,
    pub path: String,
    pub content: String,
}

/// Successful acquisition under the existing browser permission observations.
/// Browser permission may change and is still enforced by each underlying operation.
pub(crate) struct OpenedLocalFolder {
    root: Object,
}
struct LocalFolderEventName<'a> {
    name: &'a str,
}
impl<'a> LocalFolderEventName<'a> {
    fn new(name: &'a str) -> Self {
        Self { name }
    }
}

enum FolderDirectory {
    Unavailable,
    Opened(Object),
}
enum FolderFile {
    Unavailable,
    Opened(Object),
}
#[derive(Debug, PartialEq, Eq)]
enum FolderEventName {
    Unrelated,
    Event(EventId),
}
impl FolderObject<'_> {
    async fn child_directory(
        &self,
        request: ChildLookupRequest<'_>,
    ) -> Result<FolderDirectory, NookError> {
        let parent = self.object;
        let ChildLookupRequest { name, lookup } = request;
        let create = matches!(lookup, ChildLookup::Create);
        let options = lookup.options()?;
        let FolderMethod::Callable(function) =
            FolderObject::new(parent).method("getDirectoryHandle")?
        else {
            return Err(NookError::Database(
                "Local folder handle cannot open subdirectories.".to_owned(),
            ));
        };
        let call = function.call2(parent, &JsString::from(name), &options);
        match call {
            Ok(promise) => FolderPromise {
                value: promise.unchecked_into(),
            }
            .resolve("getDirectoryHandle failed")
            .await
            .map(FolderDirectory::Opened)
            .or_else(|err| {
                if create {
                    Err(err)
                } else {
                    Ok(FolderDirectory::Unavailable)
                }
            }),
            Err(err) => {
                if create {
                    Err(FolderFailure::new(&err.unchecked_into())
                        .into_error("getDirectoryHandle call failed"))
                } else {
                    Ok(FolderDirectory::Unavailable)
                }
            }
        }
    }
}

impl FolderObject<'_> {
    async fn event_directory(
        &self,
        location: &nook_core::EventLogLocation,
        lookup: ChildLookup,
    ) -> Result<FolderDirectory, NookError> {
        let root = self.object;
        let mut current = FolderDirectory::Opened(root.clone());
        let path = location.root();
        for part in path.split('/') {
            let FolderDirectory::Opened(parent) = current else {
                return Ok(FolderDirectory::Unavailable);
            };
            current = FolderObject::new(&parent)
                .child_directory(ChildLookupRequest { name: part, lookup })
                .await?;
        }
        Ok(current)
    }
}

impl FolderObject<'_> {
    async fn iterator_values(&self, method_name: &str) -> Result<Vec<Object>, NookError> {
        let target = self.object;
        let FolderMethod::Callable(function) = FolderObject::new(target).method(method_name)?
        else {
            return Ok(Vec::new());
        };
        let iterator_value = function.call0(target).map_err(|e| {
            FolderFailure::new(&e.unchecked_into())
                .into_error(&format!("{method_name} call failed"))
        })?;
        let iterator: AsyncIterator<Object> = iterator_value.unchecked_into();
        let mut values = Vec::new();
        loop {
            let next = JsFuture::from(iterator.next().map_err(|e| {
                FolderFailure::new(&e.unchecked_into()).into_error("Directory iterator next failed")
            })?)
            .await
            .map_err(|e| {
                FolderFailure::new(&e.unchecked_into())
                    .into_error("Directory iterator next rejected")
            })?;
            let next: Object = next.unchecked_into();
            let done = FolderObject::new(&next)
                .property("done")?
                .as_bool()
                .unwrap_or(false);
            if done {
                break;
            }
            values.push(FolderObject::new(&next).property("value")?);
        }
        Ok(values)
    }
}

impl FolderObject<'_> {
    /// Every child of this directory with its name: `entries()` where the
    /// handle offers it, else `values()` with each handle's own name.
    async fn named_children(&self) -> Result<Vec<(String, Object)>, NookError> {
        let dir = self.object;
        let mut children = Vec::new();
        if matches!(
            FolderObject::new(dir).method("entries")?,
            FolderMethod::Callable(_)
        ) {
            for value in FolderObject::new(dir).iterator_values("entries").await? {
                let array = Array::from(&value);
                let name = array.get(0).as_string().unwrap_or_default();
                children.push((name, array.get(1).unchecked_into()));
            }
            return Ok(children);
        }
        for handle in FolderObject::new(dir).iterator_values("values").await? {
            let name = FolderObject::new(&handle)
                .property("name")?
                .as_string()
                .unwrap_or_default();
            children.push((name, handle));
        }
        Ok(children)
    }

    fn is_kind(handle: &Object, kind: &str) -> Result<bool, NookError> {
        Ok(FolderObject::new(handle)
            .property("kind")?
            .as_string()
            .as_deref()
            == Some(kind))
    }

    async fn event_entries(&self) -> Result<Vec<(String, Object)>, NookError> {
        let mut entries = Vec::new();
        for (name, handle) in self.named_children().await? {
            if Self::is_kind(&handle, "file")?
                && matches!(
                    LocalFolderEventName::new(&name).event_id(),
                    FolderEventName::Event(_)
                )
            {
                entries.push((name, handle));
            }
        }
        Ok(entries)
    }

    /// Names of the subdirectories directly inside this directory.
    async fn directory_names(&self) -> Result<Vec<String>, NookError> {
        let mut names = Vec::new();
        for (name, handle) in self.named_children().await? {
            if Self::is_kind(&handle, "directory")? && !name.is_empty() {
                names.push(name);
            }
        }
        Ok(names)
    }
}

impl FolderObject<'_> {
    async fn read_text(&self) -> Result<String, NookError> {
        let file_handle = self.object;
        let file = FolderObject::new(file_handle).call("getFile").await?;
        let web_file: web_sys::File = file.dyn_into().map_err(|_| {
            NookError::Database("Local folder handle did not return a File.".to_owned())
        })?;
        let gloo_file = File::from(web_file);
        futures::read_as_text(&gloo_file)
            .await
            .map_err(|e| NookError::Database(format!("Local folder file read failed: {e}")))
    }
}

impl FolderObject<'_> {
    async fn child_file(&self, request: ChildLookupRequest<'_>) -> Result<FolderFile, NookError> {
        let parent = self.object;
        let ChildLookupRequest { name, lookup } = request;
        let create = matches!(lookup, ChildLookup::Create);
        let options = lookup.options()?;
        let FolderMethod::Callable(function) = FolderObject::new(parent).method("getFileHandle")?
        else {
            return Err(NookError::Database(
                "Local folder handle cannot open files.".to_owned(),
            ));
        };
        let call = function.call2(parent, &JsString::from(name), &options);
        match call {
            Ok(promise) => FolderPromise {
                value: promise.unchecked_into(),
            }
            .resolve("getFileHandle failed")
            .await
            .map(FolderFile::Opened)
            .or_else(|err| {
                if create {
                    Err(err)
                } else {
                    Ok(FolderFile::Unavailable)
                }
            }),
            Err(err) => {
                if create {
                    Err(FolderFailure::new(&err.unchecked_into())
                        .into_error("getFileHandle call failed"))
                } else {
                    Ok(FolderFile::Unavailable)
                }
            }
        }
    }
}

impl LocalFolderEventName<'_> {
    fn event_id(&self) -> FolderEventName {
        let name = self.name;
        let Some(digest) = name.strip_suffix(".yaml") else {
            return FolderEventName::Unrelated;
        };
        match EventId::parse(&format!("sha256u:{digest}")) {
            Ok(id) => FolderEventName::Event(id),
            Err(_) => FolderEventName::Unrelated,
        }
    }
}

impl LocalFolderEventName<'_> {
    fn from_event_id(event_id: &str) -> Result<String, NookError> {
        Ok(format!(
            "{}.yaml",
            EventId::parse(event_id)?.encoded_digest()
        ))
    }
}

impl OpenedLocalFolder {
    pub(crate) async fn read_events(
        &self,
        location: &nook_core::EventLogLocation,
    ) -> Result<Vec<LocalFolderEventFile>, NookError> {
        let root = &self.root;
        let FolderDirectory::Opened(dir) = FolderObject::new(root)
            .event_directory(location, ChildLookup::Existing)
            .await?
        else {
            return Ok(Vec::new());
        };
        let mut records = Vec::new();
        for (name, file_handle) in FolderObject::new(&dir).event_entries().await? {
            let FolderEventName::Event(event_id) = LocalFolderEventName::new(&name).event_id()
            else {
                continue;
            };
            records.push(LocalFolderEventFile {
                event_id: event_id.as_str().to_owned(),
                path: location.event_path(&event_id),
                content: FolderObject::new(&file_handle).read_text().await?,
            });
        }
        records.sort_by(|left, right| left.event_id.cmp(&right.event_id));
        Ok(records)
    }
    /// How many event files one namespace holds, without reading them.
    pub(crate) async fn count_events(
        &self,
        location: &nook_core::EventLogLocation,
    ) -> Result<usize, NookError> {
        let FolderDirectory::Opened(dir) = FolderObject::new(&self.root)
            .event_directory(location, ChildLookup::Existing)
            .await?
        else {
            return Ok(0);
        };
        Ok(FolderObject::new(&dir).event_entries().await?.len())
    }

    /// Ids of every namespace of one kind written to this folder.
    pub(crate) async fn list_namespace_ids(
        &self,
        kind: nook_core::EventLogNamespaceKind,
    ) -> Result<Vec<String>, NookError> {
        let mut current = FolderDirectory::Opened(self.root.clone());
        for part in kind.parent_dir().split('/') {
            let FolderDirectory::Opened(parent) = current else {
                return Ok(Vec::new());
            };
            current = FolderObject::new(&parent)
                .child_directory(ChildLookupRequest {
                    name: part,
                    lookup: ChildLookup::Existing,
                })
                .await?;
        }
        let FolderDirectory::Opened(parent) = current else {
            return Ok(Vec::new());
        };
        let mut ids = FolderObject::new(&parent).directory_names().await?;
        ids.sort();
        Ok(ids)
    }

    /// Delete one namespace's directory with every event in it (a vault
    /// deleted everywhere). Its root ends in `<name>/events`; `<name>` goes.
    /// Nothing to do when it was never written here.
    pub(crate) async fn delete_namespace(
        &self,
        location: &nook_core::EventLogLocation,
    ) -> Result<bool, NookError> {
        let root = location.root();
        let parts = root.split('/').collect::<Vec<_>>();
        let [parents @ .., name, _events] = parts.as_slice() else {
            return Err(NookError::Database(format!(
                "Namespace root {root} has no directory to delete."
            )));
        };
        let mut current = FolderDirectory::Opened(self.root.clone());
        for part in parents {
            let FolderDirectory::Opened(parent) = current else {
                return Ok(false);
            };
            current = FolderObject::new(&parent)
                .child_directory(ChildLookupRequest {
                    name: part,
                    lookup: ChildLookup::Existing,
                })
                .await?;
        }
        let FolderDirectory::Opened(parent) = current else {
            return Ok(false);
        };
        if let FolderDirectory::Unavailable = FolderObject::new(&parent)
            .child_directory(ChildLookupRequest {
                name,
                lookup: ChildLookup::Existing,
            })
            .await?
        {
            return Ok(false);
        }
        let FolderMethod::Callable(function) = FolderObject::new(&parent).method("removeEntry")?
        else {
            return Err(NookError::Database(
                "Local folder handle cannot remove entries.".to_owned(),
            ));
        };
        let options = Object::new();
        Reflect::set(
            &options,
            &JsString::from("recursive"),
            &js_sys::Boolean::from(true),
        )
        .map_err(|e| {
            FolderFailure::new(&e.unchecked_into()).into_error("removeEntry options failed")
        })?;
        let promise = function
            .call2(&parent, &JsString::from(*name), &options)
            .map_err(|e| {
                FolderFailure::new(&e.unchecked_into()).into_error("removeEntry call failed")
            })?;
        FolderPromise {
            value: promise.unchecked_into(),
        }
        .resolve("removeEntry failed")
        .await?;
        Ok(true)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::event_write::tests::{EventFixture, StreamOutcome, fixture_location};
    use super::*;
    use js_sys::{Boolean, Promise};
    use std::cell::Cell;
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn absent_directory_remains_empty_and_missing_methods_remain_errors() -> anyhow::Result<()>
    {
        let directory = Object::new();
        let reject = Closure::<dyn FnMut(Object, Object) -> Promise>::new(|_, _| {
            Promise::reject(&JsString::from("fixture directory denied"))
        });
        Reflect::set(
            &directory,
            &JsString::from("getDirectoryHandle"),
            reject.as_ref(),
        )
        .map_err(|error| {
            FolderFailure::new(&error.unchecked_into()).into_error("fixture directory")
        })?;
        let folder = OpenedLocalFolder { root: directory };
        assert!(folder.read_events(&fixture_location()?).await?.is_empty());
        match folder.write_events(&fixture_location()?, &[]).await {
            Err(NookError::Database(message)) => {
                assert_eq!(
                    message,
                    "getDirectoryHandle failed: fixture directory denied"
                );
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("creating a denied directory must reject"),
        }
        match (OpenedLocalFolder {
            root: Object::new(),
        })
        .read_events(&fixture_location()?)
        .await
        {
            Err(NookError::Database(message)) => {
                assert_eq!(message, "Local folder handle cannot open subdirectories.");
            }
            Err(error) => return Err(error.into()),
            Ok(_) => anyhow::bail!("missing directory method must reject"),
        }
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
    fn filenames_preserve_digest_and_reject_non_event_entries() -> anyhow::Result<()> {
        let id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let filename = LocalFolderEventName::from_event_id(id.as_str())?;
        assert_eq!(filename, format!("{}.yaml", id.encoded_digest()));
        assert_eq!(
            LocalFolderEventName::new(&filename).event_id(),
            FolderEventName::Event(id)
        );
        for name in [
            "notes.yaml",
            "event.json",
            "../event.yaml",
            "README",
            ".yaml",
        ] {
            assert!(matches!(
                LocalFolderEventName::new(name).event_id(),
                FolderEventName::Unrelated
            ));
        }
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
    async fn entries_and_values_filter_event_files_and_sort_records() -> anyhow::Result<()> {
        let first = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let second = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        for method in ["entries", "values"] {
            let fixture = EventFixture::new(StreamOutcome::Success)?;
            let items = Array::new();
            for (name, kind) in [
                (
                    LocalFolderEventName::from_event_id(second.as_str())?,
                    "file",
                ),
                ("notes.txt".to_owned(), "file"),
                (LocalFolderEventName::from_event_id(first.as_str())?, "file"),
                (
                    LocalFolderEventName::from_event_id(second.as_str())?,
                    "directory",
                ),
            ] {
                let file = Object::assign(&Object::new(), &fixture.file);
                for (key, value) in [("name", name.as_str()), ("kind", kind)] {
                    Reflect::set(&file, &JsString::from(key), &JsString::from(value)).map_err(
                        |error| {
                            FolderFailure::new(&error.unchecked_into()).into_error("fixture file")
                        },
                    )?;
                }
                if method == "entries" {
                    items.push(&Array::of2(&JsString::from(name), &file));
                } else {
                    items.push(&file);
                }
            }
            let index = Cell::new(0);
            let next = Closure::<dyn FnMut() -> Promise>::new(move || {
                let value = Object::new();
                let done = index.get() >= items.length();
                if let Err(error) =
                    Reflect::set(&value, &JsString::from("done"), &Boolean::from(done))
                {
                    return Promise::reject(&error);
                }
                if !done {
                    if let Err(error) =
                        Reflect::set(&value, &JsString::from("value"), &items.get(index.get()))
                    {
                        return Promise::reject(&error);
                    }
                    index.set(index.get() + 1);
                }
                Promise::resolve(&value).unchecked_into::<Promise>()
            });
            let iterator = Object::new();
            Reflect::set(&iterator, &JsString::from("next"), next.as_ref()).map_err(|error| {
                FolderFailure::new(&error.unchecked_into()).into_error("fixture iterator")
            })?;
            let enumerate = Closure::<dyn FnMut() -> Object>::new(move || iterator.clone());
            Reflect::set(
                &fixture.directory,
                &JsString::from(method),
                enumerate.as_ref(),
            )
            .map_err(|error| {
                FolderFailure::new(&error.unchecked_into()).into_error("fixture enumeration")
            })?;
            let records = (OpenedLocalFolder {
                root: fixture.directory.clone(),
            })
            .read_events(&fixture_location()?)
            .await?;
            assert_eq!(records.len(), 2);
            assert_eq!(records[0].event_id, first.as_str());
            assert_eq!(records[1].event_id, second.as_str());
            assert_eq!(records[0].path, fixture_location()?.event_path(&first));
            assert_eq!(records[1].path, fixture_location()?.event_path(&second));
            assert!(records.iter().all(|record| record.content.is_empty()));
        }
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
    async fn directory_names_list_only_named_subdirectories() -> anyhow::Result<()> {
        let items = Array::new();
        for (name, kind) in [
            ("store_b", "directory"),
            ("notes.txt", "file"),
            ("store_a", "directory"),
            ("", "directory"),
        ] {
            let handle = Object::new();
            Reflect::set(&handle, &JsString::from("kind"), &JsString::from(kind)).map_err(
                |error| FolderFailure::new(&error.unchecked_into()).into_error("fixture handle"),
            )?;
            items.push(&Array::of2(&JsString::from(name), &handle));
        }
        let index = Cell::new(0);
        let next = Closure::<dyn FnMut() -> Promise>::new(move || {
            let value = Object::new();
            let done = index.get() >= items.length();
            if let Err(error) = Reflect::set(&value, &JsString::from("done"), &Boolean::from(done))
            {
                return Promise::reject(&error);
            }
            if !done {
                if let Err(error) =
                    Reflect::set(&value, &JsString::from("value"), &items.get(index.get()))
                {
                    return Promise::reject(&error);
                }
                index.set(index.get() + 1);
            }
            Promise::resolve(&value).unchecked_into::<Promise>()
        });
        let iterator = Object::new();
        Reflect::set(&iterator, &JsString::from("next"), next.as_ref()).map_err(|error| {
            FolderFailure::new(&error.unchecked_into()).into_error("fixture iterator")
        })?;
        let enumerate = Closure::<dyn FnMut() -> Object>::new(move || iterator.clone());
        let directory = Object::new();
        Reflect::set(&directory, &JsString::from("entries"), enumerate.as_ref()).map_err(
            |error| FolderFailure::new(&error.unchecked_into()).into_error("fixture entries"),
        )?;
        assert_eq!(
            FolderObject::new(&directory).directory_names().await?,
            ["store_b", "store_a"]
        );
        Ok(())
    }
}
