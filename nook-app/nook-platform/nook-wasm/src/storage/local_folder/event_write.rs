#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Writing event files into a local folder: a stream closes only after its
//! write succeeded, and an existing event is never overwritten.
use super::handles::{ChildLookup, ChildLookupRequest, FolderCallArgument, FolderObject};
use super::{FolderDirectory, FolderFile, LocalFolderEventName, OpenedLocalFolder};
use crate::NookError;
use js_sys::{JsString, Object};
use wasm_bindgen::JsCast;

pub(crate) struct LocalFolderEventWrite {
    pub event_id: String,
    pub content: String,
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
impl OpenedLocalFolder {
    pub(crate) async fn write_events(
        &self,
        location: &nook_core::EventLogLocation,
        records: &[LocalFolderEventWrite],
    ) -> Result<(), NookError> {
        let root = &self.root;
        let FolderDirectory::Opened(dir) = FolderObject::new(root)
            .event_directory(location, ChildLookup::Create)
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
        if let FolderFile::Opened(existing) = existing {
            let current = FolderObject::new(&existing).read_text().await?;
            if current != record.content {
                return Err(NookError::Database(format!(
                    "Backup event {} already exists with different content.",
                    record.event_id
                )));
            }
            return Ok(());
        }
        let FolderFile::Opened(file) = FolderObject::new(dir)
            .child_file(ChildLookupRequest {
                name: &name,
                lookup: ChildLookup::Create,
            })
            .await?
        else {
            return Err(NookError::Database(format!(
                "Could not create backup event file: {name}"
            )));
        };
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
pub(super) mod tests {
    use super::super::*;
    use super::*;
    use futures_util::FutureExt;
    use js_sys::{Array, Promise, Reflect};
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen_test::wasm_bindgen_test;
    use web_sys::File as BrowserFile;

    pub(crate) fn fixture_location() -> anyhow::Result<nook_core::EventLogLocation> {
        Ok(nook_core::EventLogLocation::Vault(
            nook_core::StoreId::parse("store_abcdefghijk")?,
        ))
    }

    #[derive(Clone, Copy)]
    pub(crate) enum StreamOutcome {
        Success,
        WriteRejected,
        CloseRejected,
        WritePending,
    }
    pub(crate) struct EventFixture {
        pub(crate) directory: Object,
        pub(crate) file: Object,
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

        pub(crate) fn new(outcome: StreamOutcome) -> Result<Self, NookError> {
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
                callback: Closure::new(move |_, _| {
                    Promise::resolve(&parent).unchecked_into::<Promise>()
                }),
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
                        Promise::resolve(&child).unchecked_into::<Promise>()
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
                        Ok(file) => Promise::resolve(&file).unchecked_into::<Promise>(),
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
                    Promise::resolve(&writable).unchecked_into::<Promise>()
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
                    Promise::resolve(&Object::new()).unchecked_into::<Promise>()
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
                        Promise::resolve(&Object::new()).unchecked_into::<Promise>()
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
            .write_events(
                &fixture_location()?,
                &[EventFixture::record("first"), invalid],
            )
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
}
