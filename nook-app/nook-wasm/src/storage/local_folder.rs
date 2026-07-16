//! Browser File System Access adapter for local-folder sync providers.

use crate::NookError;
use gloo_file::futures::read_as_text;
use js_sys::{Array, AsyncIterator, Function, Object, Promise, Reflect};
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

const DB_NAME: &str = "nook_file_sync";
const STORE_NAME: &str = "directory_handles";
const EVENT_LOG_PARTS: [&str; 3] = ["nook-log", "v1", "events"];

thread_local! {
    static MEMORY_HANDLES: RefCell<HashMap<String, JsValue>> = RefCell::new(HashMap::new());
}

#[wasm_bindgen]
#[derive(Clone)]
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

fn js_error(context: &str, value: &JsValue) -> NookError {
    let message = value
        .as_string()
        .or_else(|| {
            Reflect::get(value, &JsValue::from_str("message"))
                .ok()
                .and_then(|message| message.as_string())
        })
        .unwrap_or_else(|| "JavaScript error".to_owned());
    NookError::Database(format!("{context}: {message}"))
}

fn get_property(target: &JsValue, property: &str) -> Result<JsValue, NookError> {
    Reflect::get(target, &JsValue::from_str(property))
        .map_err(|e| js_error(&format!("Could not read {property}"), &e))
}

fn method(target: &JsValue, name: &str) -> Result<Option<Function>, NookError> {
    let value = get_property(target, name)?;
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    value
        .dyn_into::<Function>()
        .map(Some)
        .map_err(|_| NookError::Database(format!("{name} is not a function.")))
}

async fn await_js(value: JsValue, context: &str) -> Result<JsValue, NookError> {
    JsFuture::from(Promise::from(value))
        .await
        .map_err(|e| js_error(context, &e))
}

async fn call_method0(target: &JsValue, name: &str) -> Result<JsValue, NookError> {
    let function =
        method(target, name)?.ok_or_else(|| NookError::Database(format!("{name} is missing.")))?;
    let promise = function
        .call0(target)
        .map_err(|e| js_error(&format!("{name} call failed"), &e))?;
    await_js(promise, &format!("{name} failed")).await
}

async fn call_method1(target: &JsValue, name: &str, arg: &JsValue) -> Result<JsValue, NookError> {
    let function =
        method(target, name)?.ok_or_else(|| NookError::Database(format!("{name} is missing.")))?;
    let promise = function
        .call1(target, arg)
        .map_err(|e| js_error(&format!("{name} call failed"), &e))?;
    await_js(promise, &format!("{name} failed")).await
}

fn object_with_bool(name: &str, value: bool) -> Result<Object, NookError> {
    let object = Object::new();
    Reflect::set(
        &object,
        &JsValue::from_str(name),
        &JsValue::from_bool(value),
    )
    .map_err(|e| js_error("Could not build options object", &e))?;
    Ok(object)
}

fn readwrite_permission_descriptor() -> Result<Object, NookError> {
    let object = Object::new();
    Reflect::set(
        &object,
        &JsValue::from_str("mode"),
        &JsValue::from_str("readwrite"),
    )
    .map_err(|e| js_error("Could not build permission descriptor", &e))?;
    Ok(object)
}

async fn open_handle_db() -> Result<rexie::Rexie, NookError> {
    rexie::Rexie::builder(DB_NAME)
        .version(1)
        .add_object_store(rexie::ObjectStore::new(STORE_NAME).key_path("id"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder IndexedDB build error: {e:?}")))
}

pub(crate) async fn clear_local_folder_db() -> Result<(), NookError> {
    MEMORY_HANDLES.with(|handles| handles.borrow_mut().clear());
    let rexie = open_handle_db().await?;
    let transaction = rexie
        .transaction(&[STORE_NAME], rexie::TransactionMode::ReadWrite)
        .map_err(|e| {
            NookError::IndexedDb(format!("Local folder clear transaction error: {e:?}"))
        })?;
    transaction
        .store(STORE_NAME)
        .map_err(|e| NookError::IndexedDb(format!("Local folder clear store error: {e:?}")))?
        .clear()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder clear error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder clear completion error: {e:?}")))?;
    Ok(())
}

async fn store_directory_handle(handle_id: &str, handle: JsValue) -> Result<(), NookError> {
    MEMORY_HANDLES.with(|handles| {
        handles
            .borrow_mut()
            .insert(handle_id.to_owned(), handle.clone());
    });

    let rexie = open_handle_db().await?;
    let transaction = rexie
        .transaction(&[STORE_NAME], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Local folder transaction error: {e:?}")))?;
    let store = transaction
        .store(STORE_NAME)
        .map_err(|e| NookError::IndexedDb(format!("Local folder store error: {e:?}")))?;
    let row = Object::new();
    Reflect::set(
        &row,
        &JsValue::from_str("id"),
        &JsValue::from_str(handle_id),
    )
    .map_err(|e| js_error("Could not store local folder id", &e))?;
    Reflect::set(&row, &JsValue::from_str("handle"), &handle)
        .map_err(|e| js_error("Could not store local folder handle", &e))?;
    let row: JsValue = row.into();
    store
        .put(&row, None)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder handle put error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder transaction done error: {e:?}")))?;
    Ok(())
}

async fn load_directory_handle(handle_id: &str) -> Result<Option<JsValue>, NookError> {
    if let Some(handle) = MEMORY_HANDLES.with(|handles| handles.borrow().get(handle_id).cloned()) {
        return Ok(Some(handle));
    }

    let rexie = open_handle_db().await?;
    let transaction = rexie
        .transaction(&[STORE_NAME], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Local folder transaction error: {e:?}")))?;
    let store = transaction
        .store(STORE_NAME)
        .map_err(|e| NookError::IndexedDb(format!("Local folder store error: {e:?}")))?;
    let key = JsValue::from_str(handle_id);
    let row = store
        .get(key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder handle get error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder transaction done error: {e:?}")))?;

    let Some(row) = row.filter(|value| !value.is_undefined() && !value.is_null()) else {
        return Ok(None);
    };
    let handle = get_property(&row, "handle")?;
    if handle.is_undefined() || handle.is_null() {
        return Ok(None);
    }
    MEMORY_HANDLES.with(|handles| {
        handles
            .borrow_mut()
            .insert(handle_id.to_owned(), handle.clone());
    });
    Ok(Some(handle))
}

pub(crate) async fn remove_local_folder_handle(handle_id: Option<String>) -> Result<(), NookError> {
    let Some(handle_id) = handle_id.filter(|id| !id.trim().is_empty()) else {
        return Ok(());
    };
    MEMORY_HANDLES.with(|handles| {
        handles.borrow_mut().remove(&handle_id);
    });

    let rexie = open_handle_db().await?;
    let transaction = rexie
        .transaction(&[STORE_NAME], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Local folder transaction error: {e:?}")))?;
    let store = transaction
        .store(STORE_NAME)
        .map_err(|e| NookError::IndexedDb(format!("Local folder store error: {e:?}")))?;
    store
        .delete(JsValue::from_str(&handle_id))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder handle delete error: {e:?}")))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Local folder transaction done error: {e:?}")))?;
    Ok(())
}

pub(crate) fn is_local_folder_backup_supported() -> bool {
    web_sys::window().is_some_and(|window| {
        method(&JsValue::from(window), "showDirectoryPicker")
            .ok()
            .flatten()
            .is_some()
    })
}

async fn ensure_write_permission(handle: &JsValue) -> Result<(), NookError> {
    let descriptor = JsValue::from(readwrite_permission_descriptor()?);
    let Some(query) = method(handle, "queryPermission")? else {
        return Ok(());
    };
    let current = await_js(
        query
            .call1(handle, &descriptor)
            .map_err(|e| js_error("queryPermission call failed", &e))?,
        "queryPermission failed",
    )
    .await?
    .as_string();
    if current.as_deref().is_none_or(|state| state == "granted") {
        return Ok(());
    }

    let Some(request) = method(handle, "requestPermission")? else {
        return Err(NookError::Database(
            "Folder permission was not granted.".to_owned(),
        ));
    };
    let requested = await_js(
        request
            .call1(handle, &descriptor)
            .map_err(|e| js_error("requestPermission call failed", &e))?,
        "requestPermission failed",
    )
    .await?
    .as_string();
    if requested.as_deref() != Some("granted") {
        return Err(NookError::Database(
            "Folder permission was not granted.".to_owned(),
        ));
    }
    Ok(())
}

fn random_handle_id() -> String {
    format!(
        "folder_{}_{}",
        js_sys::Date::now().round(),
        js_sys::Math::random().to_string().replace("0.", "")
    )
}

pub(crate) async fn choose_local_folder_backup_directory()
-> Result<NookLocalFolderConfig, NookError> {
    let window = web_sys::window()
        .ok_or_else(|| NookError::Database("Local folder backup requires a browser.".to_owned()))?;
    let window = JsValue::from(window);
    let picker = method(&window, "showDirectoryPicker")?.ok_or_else(|| {
        NookError::Database("Local folder backup is not supported in this browser.".to_owned())
    })?;
    let options = Object::new();
    Reflect::set(
        &options,
        &JsValue::from_str("id"),
        &JsValue::from_str("nook-local-backup"),
    )
    .map_err(|e| js_error("Could not build directory picker options", &e))?;
    Reflect::set(
        &options,
        &JsValue::from_str("mode"),
        &JsValue::from_str("readwrite"),
    )
    .map_err(|e| js_error("Could not build directory picker options", &e))?;
    let handle = await_js(
        picker
            .call1(&window, &options)
            .map_err(|e| js_error("showDirectoryPicker call failed", &e))?,
        "showDirectoryPicker failed",
    )
    .await?;
    ensure_write_permission(&handle).await?;
    let directory_name = get_property(&handle, "name")?
        .as_string()
        .unwrap_or_default();
    let handle_id = random_handle_id();
    store_directory_handle(&handle_id, handle).await?;
    Ok(NookLocalFolderConfig {
        directory_name,
        handle_id,
    })
}

async fn provider_directory_handle(handle_id: &str) -> Result<JsValue, NookError> {
    if handle_id.trim().is_empty() {
        return Err(NookError::Database(
            "Choose a local backup folder before syncing.".to_owned(),
        ));
    }
    let Some(handle) = load_directory_handle(handle_id).await? else {
        return Err(NookError::Database(
            "Reconnect this local backup folder before syncing.".to_owned(),
        ));
    };
    ensure_write_permission(&handle).await?;
    Ok(handle)
}

async fn child_directory(
    parent: &JsValue,
    name: &str,
    create: bool,
) -> Result<Option<JsValue>, NookError> {
    let options = JsValue::from(object_with_bool("create", create)?);
    let Some(function) = method(parent, "getDirectoryHandle")? else {
        return Err(NookError::Database(
            "Local folder handle cannot open subdirectories.".to_owned(),
        ));
    };
    let call = function.call2(parent, &JsValue::from_str(name), &options);
    match call {
        Ok(promise) => await_js(promise, "getDirectoryHandle failed")
            .await
            .map(Some)
            .or_else(|err| if create { Err(err) } else { Ok(None) }),
        Err(err) => {
            if create {
                Err(js_error("getDirectoryHandle call failed", &err))
            } else {
                Ok(None)
            }
        }
    }
}

async fn event_directory(root: &JsValue, create: bool) -> Result<Option<JsValue>, NookError> {
    let mut current = Some(root.clone());
    for part in EVENT_LOG_PARTS {
        let Some(parent) = current else {
            return Ok(None);
        };
        current = child_directory(&parent, part, create).await?;
    }
    Ok(current)
}

fn event_id_from_file_name(name: &str) -> Option<nook_core::EventId> {
    let digest = name.strip_suffix(".yaml")?;
    nook_core::EventId::parse(&format!("sha256u:{digest}")).ok()
}

fn event_file_name(event_id: &str) -> Result<String, NookError> {
    Ok(format!(
        "{}.yaml",
        nook_core::EventId::parse(event_id)?.encoded_digest()
    ))
}

async fn async_iterator_values(
    target: &JsValue,
    method_name: &str,
) -> Result<Vec<JsValue>, NookError> {
    let Some(function) = method(target, method_name)? else {
        return Ok(Vec::new());
    };
    let iterator_value = function
        .call0(target)
        .map_err(|e| js_error(&format!("{method_name} call failed"), &e))?;
    let iterator: AsyncIterator<JsValue> = iterator_value.unchecked_into();
    let mut values = Vec::new();
    loop {
        let next = JsFuture::from(
            iterator
                .next()
                .map_err(|e| js_error("Directory iterator next failed", &e))?,
        )
        .await
        .map_err(|e| js_error("Directory iterator next rejected", &e))?;
        let done = get_property(&next, "done")?.as_bool().unwrap_or(false);
        if done {
            break;
        }
        values.push(get_property(&next, "value")?);
    }
    Ok(values)
}

async fn event_file_entries(dir: &JsValue) -> Result<Vec<(String, JsValue)>, NookError> {
    let mut entries = Vec::new();
    if method(dir, "entries")?.is_some() {
        for value in async_iterator_values(dir, "entries").await? {
            let array = Array::from(&value);
            let name = array.get(0).as_string().unwrap_or_default();
            let handle = array.get(1);
            if get_property(&handle, "kind")?.as_string().as_deref() == Some("file")
                && event_id_from_file_name(&name).is_some()
            {
                entries.push((name, handle));
            }
        }
        return Ok(entries);
    }
    for handle in async_iterator_values(dir, "values").await? {
        let name = get_property(&handle, "name")?
            .as_string()
            .unwrap_or_default();
        if get_property(&handle, "kind")?.as_string().as_deref() == Some("file")
            && event_id_from_file_name(&name).is_some()
        {
            entries.push((name, handle));
        }
    }
    Ok(entries)
}

async fn read_file_text(file_handle: &JsValue) -> Result<String, NookError> {
    let file = call_method0(file_handle, "getFile").await?;
    let web_file: web_sys::File = file.dyn_into().map_err(|_| {
        NookError::Database("Local folder handle did not return a File.".to_owned())
    })?;
    let gloo_file = gloo_file::File::from(web_file);
    read_as_text(&gloo_file)
        .await
        .map_err(|e| NookError::Database(format!("Local folder file read failed: {e}")))
}

pub(crate) async fn read_local_folder_event_files(
    handle_id: &str,
) -> Result<Vec<LocalFolderEventFile>, NookError> {
    let root = provider_directory_handle(handle_id).await?;
    let Some(dir) = event_directory(&root, false).await? else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (name, file_handle) in event_file_entries(&dir).await? {
        let Some(event_id) = event_id_from_file_name(&name) else {
            continue;
        };
        records.push(LocalFolderEventFile {
            event_id: event_id.as_str().to_owned(),
            path: event_id.storage_path(),
            content: read_file_text(&file_handle).await?,
        });
    }
    records.sort_by(|left, right| left.event_id.cmp(&right.event_id));
    Ok(records)
}

pub(crate) async fn write_local_folder_event_files(
    handle_id: &str,
    records: &[LocalFolderEventWrite],
) -> Result<(), NookError> {
    let root = provider_directory_handle(handle_id).await?;
    let Some(dir) = event_directory(&root, true).await? else {
        return Ok(());
    };
    for record in records {
        let name = event_file_name(&record.event_id)?;
        let existing = child_file(&dir, &name, false).await?;
        if let Some(existing) = existing {
            let current = read_file_text(&existing).await?;
            if current != record.content {
                return Err(NookError::Database(format!(
                    "Backup event {} already exists with different content.",
                    record.event_id
                )));
            }
            continue;
        }
        let file = child_file(&dir, &name, true).await?.ok_or_else(|| {
            NookError::Database(format!("Could not create backup event file: {name}"))
        })?;
        let writable = call_method0(&file, "createWritable").await?;
        call_method1(&writable, "write", &JsValue::from_str(&record.content)).await?;
        call_method0(&writable, "close").await?;
    }
    Ok(())
}

async fn child_file(
    parent: &JsValue,
    name: &str,
    create: bool,
) -> Result<Option<JsValue>, NookError> {
    let options = JsValue::from(object_with_bool("create", create)?);
    let Some(function) = method(parent, "getFileHandle")? else {
        return Err(NookError::Database(
            "Local folder handle cannot open files.".to_owned(),
        ));
    };
    let call = function.call2(parent, &JsValue::from_str(name), &options);
    match call {
        Ok(promise) => await_js(promise, "getFileHandle failed")
            .await
            .map(Some)
            .or_else(|err| if create { Err(err) } else { Ok(None) }),
        Err(err) => {
            if create {
                Err(js_error("getFileHandle call failed", &err))
            } else {
                Ok(None)
            }
        }
    }
}
