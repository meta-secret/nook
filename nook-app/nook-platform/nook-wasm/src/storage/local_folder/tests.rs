use super::*;

fn fixture_location() -> anyhow::Result<nook_core::EventLogLocation> {
    Ok(nook_core::EventLogLocation::Vault(
        nook_core::StoreId::parse("store_abcdefghijk")?,
    ))
}
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
async fn successful_close_precedes_noop_and_conflicting_content_rejection() -> anyhow::Result<()> {
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
async fn absent_directory_remains_empty_and_missing_methods_remain_errors() -> anyhow::Result<()> {
    let directory = Object::new();
    let reject = Closure::<dyn FnMut(Object, Object) -> Promise>::new(|_, _| {
        Promise::reject(&JsString::from("fixture directory denied"))
    });
    Reflect::set(
        &directory,
        &JsString::from("getDirectoryHandle"),
        reject.as_ref(),
    )
    .map_err(|error| FolderFailure::new(&error.unchecked_into()).into_error("fixture directory"))?;
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
                    |error| FolderFailure::new(&error.unchecked_into()).into_error("fixture file"),
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
