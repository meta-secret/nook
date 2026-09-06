#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Handle registry and bound browser operations for local-folder transport.
use super::{NookLocalFolderConfig, OpenedLocalFolder};
use crate::NookError;
use js_sys::{Boolean, Date, Function, JsString, Math, Object, Promise, Reflect};
use rexie::{ObjectStore, Rexie, TransactionMode};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

const DB_NAME: &str = "nook_file_sync";
const STORE_NAME: &str = "directory_handles";
thread_local! {
    static MEMORY_HANDLES: Rc<RefCell<HashMap<String, Object>>> = Rc::new(RefCell::new(HashMap::new()));
}

/// Registry instances share the browser task's existing in-memory handle cache.
pub(crate) struct LocalFolderHandles {
    memory: Rc<RefCell<HashMap<String, Object>>>,
}
impl LocalFolderHandles {
    #[must_use]
    pub(crate) fn current() -> Self {
        Self {
            memory: MEMORY_HANDLES.with(Rc::clone),
        }
    }
}
struct FolderRegistration<'a> {
    handle_id: &'a str,
    handle: Object,
}

/// An observed browser object, without a permission or authenticity claim.
pub(super) struct FolderObject<'a> {
    pub(super) object: &'a Object,
}
impl<'a> FolderObject<'a> {
    pub(super) fn new(object: &'a Object) -> Self {
        Self { object }
    }
}
#[derive(Clone, Copy)]
pub(super) struct FolderCallArgument<'a> {
    pub(super) name: &'a str,
    pub(super) argument: &'a Object,
}
pub(super) struct FolderPromise {
    pub(super) value: Object,
}
pub(super) struct FolderFailure<'a> {
    value: &'a Object,
}
impl<'a> FolderFailure<'a> {
    pub(super) fn new(value: &'a Object) -> Self {
        Self { value }
    }
}
#[derive(Clone, Copy)]
pub(super) enum ChildLookup {
    Existing,
    Create,
}
#[derive(Clone, Copy)]
pub(super) struct ChildLookupRequest<'a> {
    pub(super) name: &'a str,
    pub(super) lookup: ChildLookup,
}
impl FolderFailure<'_> {
    pub(super) fn into_error(self, context: &str) -> NookError {
        let value = self.value;
        let message = value
            .as_string()
            .or_else(|| {
                Reflect::get(value, &JsString::from("message"))
                    .ok()
                    .and_then(|message| message.as_string())
            })
            .unwrap_or_else(|| "JavaScript error".to_owned());
        NookError::Database(format!("{context}: {message}"))
    }
}

impl FolderObject<'_> {
    pub(super) fn property(&self, property: &str) -> Result<Object, NookError> {
        let target = self.object;
        Reflect::get(target, &JsString::from(property))
            .map(JsCast::unchecked_into)
            .map_err(|e| {
                FolderFailure::new(&e.unchecked_into())
                    .into_error(&format!("Could not read {property}"))
            })
    }
}

impl FolderObject<'_> {
    pub(super) fn method(&self, name: &str) -> Result<Option<Function>, NookError> {
        let target = self.object;
        let value = FolderObject::new(target).property(name)?;
        if value.is_undefined() || value.is_null() {
            return Ok(None);
        }
        value
            .dyn_into::<Function>()
            .map(Some)
            .map_err(|_| NookError::Database(format!("{name} is not a function.")))
    }
}

impl FolderPromise {
    pub(super) async fn resolve(self, context: &str) -> Result<Object, NookError> {
        let value = self.value;
        let promise: Promise = value.unchecked_into();
        JsFuture::from(promise)
            .await
            .map(JsCast::unchecked_into)
            .map_err(|e| FolderFailure::new(&e.unchecked_into()).into_error(context))
    }
}

impl FolderObject<'_> {
    pub(super) async fn call(&self, name: &str) -> Result<Object, NookError> {
        let target = self.object;
        let function = FolderObject::new(target)
            .method(name)?
            .ok_or_else(|| NookError::Database(format!("{name} is missing.")))?;
        let promise = function
            .call0(target)
            .map(JsCast::unchecked_into)
            .map_err(|e| {
                FolderFailure::new(&e.unchecked_into()).into_error(&format!("{name} call failed"))
            })?;
        FolderPromise { value: promise }
            .resolve(&format!("{name} failed"))
            .await
    }
}

impl FolderObject<'_> {
    pub(super) async fn call_with(
        &self,
        call: FolderCallArgument<'_>,
    ) -> Result<Object, NookError> {
        let target = self.object;
        let FolderCallArgument {
            name,
            argument: arg,
        } = call;
        let function = FolderObject::new(target)
            .method(name)?
            .ok_or_else(|| NookError::Database(format!("{name} is missing.")))?;
        let promise = function
            .call1(target, arg)
            .map(JsCast::unchecked_into)
            .map_err(|e| {
                FolderFailure::new(&e.unchecked_into()).into_error(&format!("{name} call failed"))
            })?;
        FolderPromise { value: promise }
            .resolve(&format!("{name} failed"))
            .await
    }
}

impl ChildLookup {
    pub(super) fn options(self) -> Result<Object, NookError> {
        let name = "create";
        let value = matches!(self, Self::Create);
        let object = Object::new();
        Reflect::set(&object, &JsString::from(name), &Boolean::from(value)).map_err(|e| {
            FolderFailure::new(&e.unchecked_into()).into_error("Could not build options object")
        })?;
        Ok(object)
    }
}

impl FolderObject<'_> {
    fn permission_descriptor() -> Result<Object, NookError> {
        let object = Object::new();
        Reflect::set(
            &object,
            &JsString::from("mode"),
            &JsString::from("readwrite"),
        )
        .map_err(|e| {
            FolderFailure::new(&e.unchecked_into())
                .into_error("Could not build permission descriptor")
        })?;
        Ok(object)
    }
}

impl LocalFolderHandles {
    async fn open_database() -> Result<Rexie, NookError> {
        Rexie::builder(DB_NAME)
            .version(1)
            .add_object_store(ObjectStore::new(STORE_NAME).key_path("id"))
            .build()
            .await
            .map_err(|e| NookError::IndexedDb(format!("Local folder IndexedDB build error: {e:?}")))
    }
}

impl LocalFolderHandles {
    pub(crate) async fn clear(&self) -> Result<(), NookError> {
        self.memory.borrow_mut().clear();
        let rexie = Self::open_database().await?;
        let transaction = rexie
            .transaction(&[STORE_NAME], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!("Local folder clear transaction error: {e:?}"))
            })?;
        transaction
            .store(STORE_NAME)
            .map_err(|e| NookError::IndexedDb(format!("Local folder clear store error: {e:?}")))?
            .clear()
            .await
            .map_err(|e| NookError::IndexedDb(format!("Local folder clear error: {e:?}")))?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("Local folder clear completion error: {e:?}"))
        })?;
        Ok(())
    }
}

impl LocalFolderHandles {
    async fn store(&self, registration: FolderRegistration<'_>) -> Result<(), NookError> {
        let FolderRegistration { handle_id, handle } = registration;
        self.memory
            .borrow_mut()
            .insert(handle_id.to_owned(), handle.clone());

        let rexie = Self::open_database().await?;
        let transaction = rexie
            .transaction(&[STORE_NAME], TransactionMode::ReadWrite)
            .map_err(|e| NookError::IndexedDb(format!("Local folder transaction error: {e:?}")))?;
        let store = transaction
            .store(STORE_NAME)
            .map_err(|e| NookError::IndexedDb(format!("Local folder store error: {e:?}")))?;
        let row = Object::new();
        Reflect::set(&row, &JsString::from("id"), &JsString::from(handle_id)).map_err(|e| {
            FolderFailure::new(&e.unchecked_into()).into_error("Could not store local folder id")
        })?;
        Reflect::set(&row, &JsString::from("handle"), &handle).map_err(|e| {
            FolderFailure::new(&e.unchecked_into())
                .into_error("Could not store local folder handle")
        })?;
        store
            .put(&row, None)
            .await
            .map_err(|e| NookError::IndexedDb(format!("Local folder handle put error: {e:?}")))?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("Local folder transaction done error: {e:?}"))
        })?;
        Ok(())
    }
}

impl LocalFolderHandles {
    async fn load(&self, handle_id: &str) -> Result<Option<Object>, NookError> {
        if let Some(handle) = self.memory.borrow().get(handle_id).cloned() {
            return Ok(Some(handle));
        }

        let rexie = Self::open_database().await?;
        let transaction = rexie
            .transaction(&[STORE_NAME], TransactionMode::ReadOnly)
            .map_err(|e| NookError::IndexedDb(format!("Local folder transaction error: {e:?}")))?;
        let store = transaction
            .store(STORE_NAME)
            .map_err(|e| NookError::IndexedDb(format!("Local folder store error: {e:?}")))?;
        let key = JsString::from(handle_id);
        let row = store
            .get(key.into())
            .await
            .map_err(|e| NookError::IndexedDb(format!("Local folder handle get error: {e:?}")))?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("Local folder transaction done error: {e:?}"))
        })?;

        let Some(row) = row.filter(|value| !value.is_undefined() && !value.is_null()) else {
            return Ok(None);
        };
        let row: Object = row.unchecked_into();
        let handle = FolderObject::new(&row).property("handle")?;
        if handle.is_undefined() || handle.is_null() {
            return Ok(None);
        }
        self.memory
            .borrow_mut()
            .insert(handle_id.to_owned(), handle.clone());
        Ok(Some(handle))
    }
}

impl LocalFolderHandles {
    pub(crate) async fn remove(&self, handle_id: Option<String>) -> Result<(), NookError> {
        let Some(handle_id) = handle_id.filter(|id| !id.trim().is_empty()) else {
            return Ok(());
        };
        self.memory.borrow_mut().remove(&handle_id);

        let rexie = Self::open_database().await?;
        let transaction = rexie
            .transaction(&[STORE_NAME], TransactionMode::ReadWrite)
            .map_err(|e| NookError::IndexedDb(format!("Local folder transaction error: {e:?}")))?;
        let store = transaction
            .store(STORE_NAME)
            .map_err(|e| NookError::IndexedDb(format!("Local folder store error: {e:?}")))?;
        store
            .delete(JsString::from(handle_id).into())
            .await
            .map_err(|e| {
                NookError::IndexedDb(format!("Local folder handle delete error: {e:?}"))
            })?;
        transaction.done().await.map_err(|e| {
            NookError::IndexedDb(format!("Local folder transaction done error: {e:?}"))
        })?;
        Ok(())
    }
}

impl NookLocalFolderConfig {
    #[must_use]
    pub(crate) fn is_supported() -> bool {
        web_sys::window().is_some_and(|window| {
            FolderObject::new(&window.into())
                .method("showDirectoryPicker")
                .ok()
                .flatten()
                .is_some()
        })
    }
}

impl FolderObject<'_> {
    pub(super) async fn observe_write_permission(&self) -> Result<(), NookError> {
        let handle = self.object;
        let descriptor = Self::permission_descriptor()?;
        let Some(query) = FolderObject::new(handle).method("queryPermission")? else {
            return Ok(());
        };
        let current = FolderPromise {
            value: query
                .call1(handle, &descriptor)
                .map(JsCast::unchecked_into)
                .map_err(|e| {
                    FolderFailure::new(&e.unchecked_into())
                        .into_error("queryPermission call failed")
                })?,
        }
        .resolve("queryPermission failed")
        .await?
        .as_string();
        if current.as_deref().is_none_or(|state| state == "granted") {
            return Ok(());
        }

        let Some(request) = FolderObject::new(handle).method("requestPermission")? else {
            return Err(NookError::Database(
                "Folder permission was not granted.".to_owned(),
            ));
        };
        let requested = FolderPromise {
            value: request
                .call1(handle, &descriptor)
                .map(JsCast::unchecked_into)
                .map_err(|e| {
                    FolderFailure::new(&e.unchecked_into())
                        .into_error("requestPermission call failed")
                })?,
        }
        .resolve("requestPermission failed")
        .await?
        .as_string();
        if requested.as_deref() != Some("granted") {
            return Err(NookError::Database(
                "Folder permission was not granted.".to_owned(),
            ));
        }
        Ok(())
    }
}

impl NookLocalFolderConfig {
    fn random_handle_id() -> String {
        format!(
            "folder_{}_{}",
            Date::now().round(),
            Math::random().to_string().replace("0.", "")
        )
    }
}

impl NookLocalFolderConfig {
    pub(crate) async fn choose() -> Result<Self, NookError> {
        let window = web_sys::window().ok_or_else(|| {
            NookError::Database("Local folder backup requires a browser.".to_owned())
        })?;
        let window: Object = window.into();
        let picker = FolderObject::new(&window)
            .method("showDirectoryPicker")?
            .ok_or_else(|| {
                NookError::Database(
                    "Local folder backup is not supported in this browser.".to_owned(),
                )
            })?;
        let options = Object::new();
        Reflect::set(
            &options,
            &JsString::from("id"),
            &JsString::from("nook-local-backup"),
        )
        .map_err(|e| {
            FolderFailure::new(&e.unchecked_into())
                .into_error("Could not build directory picker options")
        })?;
        Reflect::set(
            &options,
            &JsString::from("mode"),
            &JsString::from("readwrite"),
        )
        .map_err(|e| {
            FolderFailure::new(&e.unchecked_into())
                .into_error("Could not build directory picker options")
        })?;
        let handle = FolderPromise {
            value: picker
                .call1(&window, &options)
                .map(JsCast::unchecked_into)
                .map_err(|e| {
                    FolderFailure::new(&e.unchecked_into())
                        .into_error("showDirectoryPicker call failed")
                })?,
        }
        .resolve("showDirectoryPicker failed")
        .await?;
        FolderObject::new(&handle)
            .observe_write_permission()
            .await?;
        let directory_name = FolderObject::new(&handle)
            .property("name")?
            .as_string()
            .unwrap_or_default();
        let handle_id = Self::random_handle_id();
        LocalFolderHandles::current()
            .store(FolderRegistration {
                handle_id: &handle_id,
                handle,
            })
            .await?;
        Ok(NookLocalFolderConfig {
            directory_name,
            handle_id,
        })
    }
}

impl LocalFolderHandles {
    pub(crate) async fn open_folder(
        &self,
        handle_id: &str,
    ) -> Result<OpenedLocalFolder, NookError> {
        if handle_id.trim().is_empty() {
            return Err(NookError::Database(
                "Choose a local backup folder before syncing.".to_owned(),
            ));
        }
        let Some(handle) = self.load(handle_id).await? else {
            return Err(NookError::Database(
                "Reconnect this local backup folder before syncing.".to_owned(),
            ));
        };
        FolderObject::new(&handle)
            .observe_write_permission()
            .await?;
        Ok(OpenedLocalFolder { root: handle })
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct PermissionFixture {
        handle: Object,
        calls: Rc<RefCell<Vec<String>>>,
        callbacks: Vec<Closure<dyn FnMut(Object) -> Promise>>,
    }
    struct PermissionResponse<'a> {
        method: &'a str,
        value: Object,
    }

    impl PermissionFixture {
        fn new() -> Self {
            Self {
                handle: Object::new(),
                calls: Rc::new(RefCell::new(Vec::new())),
                callbacks: Vec::new(),
            }
        }
        fn responds(&mut self, response: PermissionResponse<'_>) -> Result<(), NookError> {
            let PermissionResponse { method, value } = response;
            let calls = Rc::clone(&self.calls);
            let name = method.to_owned();
            let callback = Closure::<dyn FnMut(Object) -> Promise>::new(move |_descriptor| {
                calls.borrow_mut().push(name.clone());
                Promise::resolve(&value).unchecked_into::<Promise>()
            });
            Reflect::set(&self.handle, &JsString::from(method), callback.as_ref()).map_err(
                |error| FolderFailure::new(&error.unchecked_into()).into_error("fixture method"),
            )?;
            self.callbacks.push(callback);
            Ok(())
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
    async fn permission_observations_preserve_missing_non_string_and_request_behavior()
    -> anyhow::Result<()> {
        let missing = PermissionFixture::new();
        FolderObject::new(&missing.handle)
            .observe_write_permission()
            .await?;
        for value in [Object::new(), JsString::from("granted").unchecked_into()] {
            let mut fixture = PermissionFixture::new();
            fixture.responds(PermissionResponse {
                method: "queryPermission",
                value,
            })?;
            FolderObject::new(&fixture.handle)
                .observe_write_permission()
                .await?;
            assert_eq!(*fixture.calls.borrow(), ["queryPermission"]);
        }
        let mut fixture = PermissionFixture::new();
        fixture.responds(PermissionResponse {
            method: "queryPermission",
            value: JsString::from("prompt").unchecked_into(),
        })?;
        match FolderObject::new(&fixture.handle)
            .observe_write_permission()
            .await
        {
            Err(NookError::Database(message)) => {
                assert_eq!(message, "Folder permission was not granted.");
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("missing request must reject prompted permission"),
        }
        fixture.calls.borrow_mut().clear();
        fixture.responds(PermissionResponse {
            method: "requestPermission",
            value: JsString::from("granted").unchecked_into(),
        })?;
        FolderObject::new(&fixture.handle)
            .observe_write_permission()
            .await?;
        assert_eq!(
            *fixture.calls.borrow(),
            ["queryPermission", "requestPermission"]
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
    async fn denied_permission_and_non_callable_methods_keep_exact_errors() -> anyhow::Result<()> {
        let mut fixture = PermissionFixture::new();
        for method in ["queryPermission", "requestPermission"] {
            fixture.responds(PermissionResponse {
                method,
                value: JsString::from("denied").unchecked_into(),
            })?;
        }
        match FolderObject::new(&fixture.handle)
            .observe_write_permission()
            .await
        {
            Err(NookError::Database(message)) => {
                assert_eq!(message, "Folder permission was not granted.");
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("denied permission must reject"),
        }
        Reflect::set(
            &fixture.handle,
            &JsString::from("queryPermission"),
            &JsString::from("not callable"),
        )
        .map_err(|error| FolderFailure::new(&error.unchecked_into()).into_error("fixture query"))?;
        match FolderObject::new(&fixture.handle)
            .observe_write_permission()
            .await
        {
            Err(NookError::Database(message)) => {
                assert_eq!(message, "queryPermission is not a function.");
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("non-callable permission method must reject"),
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
    async fn registry_roundtrip_and_failed_persistence_keep_memory_first_order()
    -> anyhow::Result<()> {
        let registry = LocalFolderHandles {
            memory: Rc::new(RefCell::new(HashMap::new())),
        };
        let handle_id = "folder_registry_fixture";
        registry
            .store(FolderRegistration {
                handle_id,
                handle: Object::new(),
            })
            .await?;
        registry.remove(None).await?;
        registry.remove(Some(" ".to_owned())).await?;
        assert!(registry.memory.borrow().contains_key(handle_id));
        registry.memory.borrow_mut().clear();
        assert!(registry.load(handle_id).await?.is_some());
        registry.remove(Some(handle_id.to_owned())).await?;
        assert!(registry.load(handle_id).await?.is_none());
        let mut uncloneable = PermissionFixture::new();
        uncloneable.responds(PermissionResponse {
            method: "queryPermission",
            value: Object::new(),
        })?;
        match registry
            .store(FolderRegistration {
                handle_id,
                handle: uncloneable.handle.clone(),
            })
            .await
        {
            Err(NookError::IndexedDb(message)) => {
                assert!(message.starts_with("Local folder handle put error:"));
            }
            Err(error) => return Err(error.into()),
            Ok(()) => anyhow::bail!("a function-bearing object must not be structured-cloned"),
        }
        assert!(registry.memory.borrow().contains_key(handle_id));
        registry.remove(Some(handle_id.to_owned())).await?;
        registry
            .store(FolderRegistration {
                handle_id,
                handle: Object::new(),
            })
            .await?;
        registry.clear().await?;
        assert!(registry.memory.borrow().is_empty());
        assert!(registry.load(handle_id).await?.is_none());
        Ok(())
    }
}
