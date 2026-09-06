#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Browser File System Access adapter for local-folder sync providers.
use crate::NookError;
use gloo_file::{File, futures};
use js_sys::{Array, AsyncIterator, JsString, Object};
use nook_core::EventId;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen_futures::JsFuture;
mod handles;
pub(crate) use handles::LocalFolderHandles;
use handles::{
    ChildLookup, ChildLookupRequest, FolderCallArgument, FolderFailure, FolderObject, FolderPromise,
};
const EVENT_LOG_PARTS: [&str; 3] = ["nook-log", "v1", "events"];

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

pub(crate) struct LocalFolderEventWrite {
    pub event_id: String,
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

/// An opened stream exposes writing, but cannot be closed through this state.
struct WritableLocalFolderEvent {
    stream: Object,
}
/// Only successful writing produces the state that can close the stream.
struct WrittenLocalFolderEvent {
    stream: Object,
}
impl WritableLocalFolderEvent {
    async fn write(self, content: &str) -> Result<WrittenLocalFolderEvent, NookError> {
        let content: Object = JsString::from(content).unchecked_into();
        FolderObject::new(&self.stream)
            .call_with(FolderCallArgument {
                name: "write",
                argument: &content,
            })
            .await?;
        Ok(WrittenLocalFolderEvent {
            stream: self.stream,
        })
    }
}
impl WrittenLocalFolderEvent {
    async fn close(self) -> Result<(), NookError> {
        FolderObject::new(&self.stream).call("close").await?;
        Ok(())
    }
}
impl FolderObject<'_> {
    async fn child_directory(
        &self,
        request: ChildLookupRequest<'_>,
    ) -> Result<Option<Object>, NookError> {
        let parent = self.object;
        let ChildLookupRequest { name, lookup } = request;
        let create = matches!(lookup, ChildLookup::Create);
        let options = lookup.options()?;
        let Some(function) = FolderObject::new(parent).method("getDirectoryHandle")? else {
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
            .map(Some)
            .or_else(|err| if create { Err(err) } else { Ok(None) }),
            Err(err) => {
                if create {
                    Err(FolderFailure::new(&err.unchecked_into())
                        .into_error("getDirectoryHandle call failed"))
                } else {
                    Ok(None)
                }
            }
        }
    }
}

impl FolderObject<'_> {
    async fn event_directory(&self, lookup: ChildLookup) -> Result<Option<Object>, NookError> {
        let root = self.object;
        let mut current = Some(root.clone());
        for part in EVENT_LOG_PARTS {
            let Some(parent) = current else {
                return Ok(None);
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
        let Some(function) = FolderObject::new(target).method(method_name)? else {
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
    async fn event_entries(&self) -> Result<Vec<(String, Object)>, NookError> {
        let dir = self.object;
        let mut entries = Vec::new();
        if FolderObject::new(dir).method("entries")?.is_some() {
            for value in FolderObject::new(dir).iterator_values("entries").await? {
                let array = Array::from(&value);
                let name = array.get(0).as_string().unwrap_or_default();
                let handle: Object = array.get(1).unchecked_into();
                if FolderObject::new(&handle)
                    .property("kind")?
                    .as_string()
                    .as_deref()
                    == Some("file")
                    && LocalFolderEventName::new(&name).event_id().is_some()
                {
                    entries.push((name, handle));
                }
            }
            return Ok(entries);
        }
        for handle in FolderObject::new(dir).iterator_values("values").await? {
            let name = FolderObject::new(&handle)
                .property("name")?
                .as_string()
                .unwrap_or_default();
            if FolderObject::new(&handle)
                .property("kind")?
                .as_string()
                .as_deref()
                == Some("file")
                && LocalFolderEventName::new(&name).event_id().is_some()
            {
                entries.push((name, handle));
            }
        }
        Ok(entries)
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
    async fn child_file(
        &self,
        request: ChildLookupRequest<'_>,
    ) -> Result<Option<Object>, NookError> {
        let parent = self.object;
        let ChildLookupRequest { name, lookup } = request;
        let create = matches!(lookup, ChildLookup::Create);
        let options = lookup.options()?;
        let Some(function) = FolderObject::new(parent).method("getFileHandle")? else {
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
            .map(Some)
            .or_else(|err| if create { Err(err) } else { Ok(None) }),
            Err(err) => {
                if create {
                    Err(FolderFailure::new(&err.unchecked_into())
                        .into_error("getFileHandle call failed"))
                } else {
                    Ok(None)
                }
            }
        }
    }
}

impl LocalFolderEventName<'_> {
    fn event_id(&self) -> Option<EventId> {
        let name = self.name;
        let digest = name.strip_suffix(".yaml")?;
        EventId::parse(&format!("sha256u:{digest}")).ok()
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
    pub(crate) async fn read_events(&self) -> Result<Vec<LocalFolderEventFile>, NookError> {
        let root = &self.root;
        let Some(dir) = FolderObject::new(root)
            .event_directory(ChildLookup::Existing)
            .await?
        else {
            return Ok(Vec::new());
        };
        let mut records = Vec::new();
        for (name, file_handle) in FolderObject::new(&dir).event_entries().await? {
            let Some(event_id) = LocalFolderEventName::new(&name).event_id() else {
                continue;
            };
            records.push(LocalFolderEventFile {
                event_id: event_id.as_str().to_owned(),
                path: event_id.storage_path(),
                content: FolderObject::new(&file_handle).read_text().await?,
            });
        }
        records.sort_by(|left, right| left.event_id.cmp(&right.event_id));
        Ok(records)
    }
    pub(crate) async fn write_events(
        &self,
        records: &[LocalFolderEventWrite],
    ) -> Result<(), NookError> {
        let root = &self.root;
        let Some(dir) = FolderObject::new(root)
            .event_directory(ChildLookup::Create)
            .await?
        else {
            return Ok(());
        };
        for record in records {
            record.write_into(&dir).await?;
        }
        Ok(())
    }
}
impl LocalFolderEventWrite {
    async fn write_into(&self, dir: &Object) -> Result<(), NookError> {
        let record = self;
        let name = LocalFolderEventName::from_event_id(&record.event_id)?;
        let existing = FolderObject::new(dir)
            .child_file(ChildLookupRequest {
                name: &name,
                lookup: ChildLookup::Existing,
            })
            .await?;
        if let Some(existing) = existing {
            let current = FolderObject::new(&existing).read_text().await?;
            if current != record.content {
                return Err(NookError::Database(format!(
                    "Backup event {} already exists with different content.",
                    record.event_id
                )));
            }
            return Ok(());
        }
        let file = FolderObject::new(dir)
            .child_file(ChildLookupRequest {
                name: &name,
                lookup: ChildLookup::Create,
            })
            .await?
            .ok_or_else(|| {
                NookError::Database(format!("Could not create backup event file: {name}"))
            })?;
        let stream = FolderObject::new(&file).call("createWritable").await?;
        WritableLocalFolderEvent { stream }
            .write(&record.content)
            .await?
            .close()
            .await?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use futures_util::FutureExt;
    use js_sys::{Boolean, Promise, Reflect};
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen_test::wasm_bindgen_test;
    use web_sys::File as BrowserFile;

    #[derive(Clone, Copy)]
    enum StreamOutcome {
        Success,
        WriteRejected,
        CloseRejected,
        WritePending,
    }
    struct EventFixture {
        directory: Object,
        file: Object,
        stream: Object,
        calls: Rc<RefCell<Vec<String>>>,
        content: Rc<RefCell<String>>,
        callbacks: Vec<Closure<dyn FnMut(Object, Object) -> Promise>>,
    }
    struct FixtureMethod<'a> {
        target: &'a Object,
        name: &'a str,
        callback: Closure<dyn FnMut(Object, Object) -> Promise>,
    }

    impl EventFixture {
        fn install(&mut self, method: FixtureMethod<'_>) -> Result<(), NookError> {
            Reflect::set(
                method.target,
                &JsString::from(method.name),
                method.callback.as_ref(),
            )
            .map_err(|error| {
                FolderFailure::new(&error.unchecked_into()).into_error("fixture method")
            })?;
            self.callbacks.push(method.callback);
            Ok(())
        }

        fn new(outcome: StreamOutcome) -> Result<Self, NookError> {
            let directory = Object::new();
            let file = Object::new();
            let stream = Object::new();
            let mut fixture = Self {
                directory: directory.clone(),
                file: file.clone(),
                stream: stream.clone(),
                calls: Rc::new(RefCell::new(Vec::new())),
                content: Rc::new(RefCell::new(String::new())),
                callbacks: Vec::new(),
            };
            let parent = directory.clone();
            fixture.install(FixtureMethod {
                target: &directory,
                name: "getDirectoryHandle",
                callback: Closure::new(move |_, _| Promise::resolve(&parent)),
            })?;
            let found = Rc::new(Cell::new(false));
            let child = file.clone();
            fixture.install(FixtureMethod {
                target: &directory,
                name: "getFileHandle",
                callback: Closure::new(move |_, options: Object| {
                    let create = Reflect::get(&options, &JsString::from("create"))
                        .ok()
                        .and_then(|value| value.as_bool())
                        == Some(true);
                    if create {
                        found.set(true);
                    }
                    if found.get() {
                        Promise::resolve(&child)
                    } else {
                        Promise::reject(&JsString::from("fixture file absent"))
                    }
                }),
            })?;
            let content = Rc::clone(&fixture.content);
            fixture.install(FixtureMethod {
                target: &file,
                name: "getFile",
                callback: Closure::new(move |_, _| {
                    let parts = Array::of1(&JsString::from(content.borrow().as_str()));
                    match BrowserFile::new_with_str_sequence(&parts, "event.yaml") {
                        Ok(file) => Promise::resolve(&file),
                        Err(error) => Promise::reject(&error),
                    }
                }),
            })?;
            let writable = stream.clone();
            let calls = Rc::clone(&fixture.calls);
            fixture.install(FixtureMethod {
                target: &file,
                name: "createWritable",
                callback: Closure::new(move |_, _| {
                    calls.borrow_mut().push("createWritable".to_owned());
                    Promise::resolve(&writable)
                }),
            })?;
            let calls = Rc::clone(&fixture.calls);
            let content = Rc::clone(&fixture.content);
            let reject_write = matches!(outcome, StreamOutcome::WriteRejected);
            let pending_write = matches!(outcome, StreamOutcome::WritePending);
            fixture.install(FixtureMethod {
                target: &stream,
                name: "write",
                callback: Closure::new(move |value: Object, _| {
                    calls.borrow_mut().push("write".to_owned());
                    if pending_write {
                        return Promise::new(&mut |_, _| {});
                    }
                    if reject_write {
                        return Promise::reject(&JsString::from("fixture write rejected"));
                    }
                    let Some(value) = value.as_string() else {
                        return Promise::reject(&JsString::from("fixture requires text"));
                    };
                    *content.borrow_mut() = value;
                    Promise::resolve(&Object::new())
                }),
            })?;
            let calls = Rc::clone(&fixture.calls);
            let reject_close = matches!(outcome, StreamOutcome::CloseRejected);
            fixture.install(FixtureMethod {
                target: &stream,
                name: "close",
                callback: Closure::new(move |_, _| {
                    calls.borrow_mut().push("close".to_owned());
                    if reject_close {
                        Promise::reject(&JsString::from("fixture close rejected"))
                    } else {
                        Promise::resolve(&Object::new())
                    }
                }),
            })?;
            Ok(fixture)
        }

        fn record(content: &str) -> LocalFolderEventWrite {
            LocalFolderEventWrite {
                event_id: format!("sha256u:{}", "A".repeat(43)),
                content: content.to_owned(),
            }
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn successful_close_precedes_noop_and_conflicting_content_rejection() -> anyhow::Result<()>
    {
        let fixture = EventFixture::new(StreamOutcome::Success)?;
        EventFixture::record("first")
            .write_into(&fixture.directory)
            .await?;
        assert_eq!(
            *fixture.calls.borrow(),
            ["createWritable", "write", "close"]
        );
        EventFixture::record("first")
            .write_into(&fixture.directory)
            .await?;
        assert_eq!(
            *fixture.calls.borrow(),
            ["createWritable", "write", "close"]
        );
        let conflicting = EventFixture::record("different");
        match conflicting.write_into(&fixture.directory).await {
            Err(NookError::Database(message)) => {
                assert_eq!(
                    message,
                    format!(
                        "Backup event {} already exists with different content.",
                        conflicting.event_id
                    )
                );
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("existing different content must reject"),
        }
        assert_eq!(*fixture.content.borrow(), "first");
        assert_eq!(
            *fixture.calls.borrow(),
            ["createWritable", "write", "close"]
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
    async fn failed_write_never_closes_and_failed_close_is_propagated() -> anyhow::Result<()> {
        for outcome in [StreamOutcome::WriteRejected, StreamOutcome::CloseRejected] {
            let write_rejected = matches!(outcome, StreamOutcome::WriteRejected);
            let fixture = EventFixture::new(outcome)?;
            match EventFixture::record("first")
                .write_into(&fixture.directory)
                .await
            {
                Err(NookError::Database(message)) => {
                    assert_eq!(
                        message,
                        if write_rejected {
                            "write failed: fixture write rejected"
                        } else {
                            "close failed: fixture close rejected"
                        }
                    );
                }
                Err(error) => return Err(error.into()),
                Ok(()) => anyhow::bail!("injected stream failure must propagate"),
            }
            let expected: &[&str] = if write_rejected {
                &["createWritable", "write"]
            } else {
                &["createWritable", "write", "close"]
            };
            assert_eq!(fixture.calls.borrow().as_slice(), expected);
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
    async fn later_invalid_id_preserves_already_completed_record() -> anyhow::Result<()> {
        let fixture = EventFixture::new(StreamOutcome::Success)?;
        let folder = OpenedLocalFolder {
            root: fixture.directory.clone(),
        };
        let invalid = LocalFolderEventWrite {
            event_id: "invalid".to_owned(),
            content: "second".to_owned(),
        };
        match folder
            .write_events(&[EventFixture::record("first"), invalid])
            .await
        {
            Err(NookError::Database(message)) => {
                assert_eq!(
                    message,
                    "event id must start with sha256u: (got \"invalid\")"
                );
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("later invalid event id must reject"),
        }
        assert_eq!(*fixture.content.borrow(), "first");
        assert_eq!(
            *fixture.calls.borrow(),
            ["createWritable", "write", "close"]
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
        assert!(folder.read_events().await?.is_empty());
        match folder.write_events(&[]).await {
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
        .read_events()
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
        assert_eq!(LocalFolderEventName::new(&filename).event_id(), Some(id));
        for name in [
            "notes.yaml",
            "event.json",
            "../event.yaml",
            "README",
            ".yaml",
        ] {
            assert!(LocalFolderEventName::new(name).event_id().is_none());
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
    fn dropping_pending_write_does_not_close_the_stream() -> anyhow::Result<()> {
        let fixture = EventFixture::new(StreamOutcome::WritePending)?;
        let completion = WritableLocalFolderEvent {
            stream: fixture.stream.clone(),
        }
        .write("first")
        .now_or_never();
        assert!(completion.is_none());
        assert_eq!(*fixture.calls.borrow(), ["write"]);
        assert!(fixture.content.borrow().is_empty());
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
                Promise::resolve(&value)
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
            .read_events()
            .await?;
            assert_eq!(records.len(), 2);
            assert_eq!(records[0].event_id, first.as_str());
            assert_eq!(records[1].event_id, second.as_str());
            assert_eq!(records[0].path, first.storage_path());
            assert_eq!(records[1].path, second.storage_path());
            assert!(records.iter().all(|record| record.content.is_empty()));
        }
        Ok(())
    }
}
