//! Backend-specific storage adapters used by the session manager.
//!
//! Each submodule fronts one of the providers the web layer can pick via
//! `nook_core::StorageMode`. New backends (S3, IPFS, …) become new
//! submodules with the same async function shape.

use rexie::{ObjectStore, Rexie, TransactionMode};

use crate::NookError;
use std::{cell::RefCell, ops::Deref, rc::Rc};

pub(crate) mod auth_providers;
mod checked_event_write;
pub(crate) mod device_access;
pub(crate) mod drive;
pub(crate) mod drive_events;
pub(crate) mod drive_namespace;
pub(crate) mod drive_shared;
pub(crate) mod event_db;
pub(crate) mod extension_state;
pub(crate) mod github;
pub(crate) mod github_events;
pub(crate) mod icloud;
pub(crate) mod identity_log;
pub(crate) mod identity_record;
pub(crate) mod indexed_db;
pub(crate) mod local_folder;
pub(crate) mod remote_event;
pub(crate) mod session;

thread_local! {
    /// IndexedDB can dispatch a queued version-change callback after an async
    /// opener resolves. Keep cold-start handles alive so wasm-bindgen never
    /// receives that callback after its Rust closure has been dropped.
    static NOOK_DATABASE_CONNECTIONS: RefCell<Vec<Rc<rexie::Rexie>>> = const {
        RefCell::new(Vec::new())
    };
}

/// Open database capability. The retained connection owns transaction access.
#[derive(Clone)]
pub(crate) struct NookDatabase {
    connection: Rc<Rexie>,
}

impl Deref for NookDatabase {
    type Target = Rexie;
    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

impl NookDatabase {
    pub(crate) async fn open_nook_database() -> Result<NookDatabase, NookError> {
        if let Some(connection) =
            NOOK_DATABASE_CONNECTIONS.with(|connections| connections.borrow().first().cloned())
            && connection
                .transaction(&["vault"], TransactionMode::ReadOnly)
                .is_ok()
        {
            return Ok(NookDatabase { connection });
        }

        let connection = Rc::new(
            Rexie::builder("nook_db")
                .version(2)
                .add_object_store(ObjectStore::new("vault"))
                .add_object_store(ObjectStore::new("events"))
                .add_object_store(ObjectStore::new("projections"))
                .add_object_store(ObjectStore::new("provider_receipts"))
                .add_object_store(ObjectStore::new("outbox"))
                .build()
                .await
                .map_err(|error| {
                    NookError::IndexedDb(format!("IndexedDB build error: {error:?}"))
                })?,
        );
        let connection = NOOK_DATABASE_CONNECTIONS.with(|connections| {
            let mut connections = connections.borrow_mut();
            connections.retain(|existing| {
                existing
                    .transaction(&["vault"], TransactionMode::ReadOnly)
                    .is_ok()
            });
            if let Some(existing) = connections.first().cloned() {
                connections.push(connection);
                existing
            } else {
                connections.push(connection.clone());
                connection
            }
        });
        Ok(NookDatabase { connection })
    }
}

/// Scripted `fetch` for provider adapter tests. Each route answers one
/// request, matched by method and URL fragment in order; anything unmatched
/// gets a 404. Dropping the stub restores the browser's `fetch`.
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
pub(crate) mod fetch_stub {
    use crate::NookError;
    use js_sys::{Function, JsString, Object, Promise, Reflect};
    use std::cell::RefCell;
    use std::rc::Rc;
    use wasm_bindgen::JsCast;
    use wasm_bindgen::closure::Closure;
    use web_sys::{Request, Response, ResponseInit};

    pub(crate) struct FetchRoute {
        pub(crate) method: &'static str,
        pub(crate) url_contains: String,
        pub(crate) status: u16,
        pub(crate) body: String,
    }

    impl FetchRoute {
        pub(crate) fn ok(method: &'static str, url_contains: &str, body: &str) -> Self {
            Self {
                method,
                url_contains: url_contains.to_owned(),
                status: 200,
                body: body.to_owned(),
            }
        }

        pub(crate) fn failing(method: &'static str, url_contains: &str, status: u16) -> Self {
            Self {
                method,
                url_contains: url_contains.to_owned(),
                status,
                body: "{}".to_owned(),
            }
        }
    }

    pub(crate) struct FetchStub {
        calls: Rc<RefCell<Vec<String>>>,
        original: Function,
        _handler: Closure<dyn FnMut(Request) -> Promise>,
    }

    impl FetchStub {
        pub(crate) fn install(routes: Vec<FetchRoute>) -> Result<Self, NookError> {
            let global = js_sys::global();
            let key = JsString::from("fetch");
            let original: Function = Reflect::get(&global, &key)
                .map_err(|_| NookError::Database("fetch is unavailable".to_owned()))?
                .unchecked_into();
            let calls = Rc::new(RefCell::new(Vec::new()));
            let seen = Rc::clone(&calls);
            let routes = RefCell::new(routes);
            let handler = Closure::<dyn FnMut(Request) -> Promise>::new(move |request: Request| {
                let method = request.method();
                let url = request.url();
                seen.borrow_mut().push(format!("{method} {url}"));
                let mut routes = routes.borrow_mut();
                let matched = routes.iter().position(|route| {
                    route.method == method && url.contains(route.url_contains.as_str())
                });
                let (status, body) = match matched {
                    Some(index) => {
                        let route = routes.remove(index);
                        (route.status, route.body)
                    }
                    None => (404, "{}".to_owned()),
                };
                let init = ResponseInit::new();
                init.set_status(status);
                match Response::new_with_opt_str_and_init(Some(&body), &init) {
                    Ok(response) => {
                        // A constructed Response has no URL; HTTP clients read it.
                        let descriptor = Object::new();
                        if let Err(error) = Reflect::set(
                            &descriptor,
                            &JsString::from("value"),
                            &JsString::from(url),
                        )
                        .and_then(|_| {
                            Reflect::define_property(&response, &JsString::from("url"), &descriptor)
                        }) {
                            return Promise::reject(&error);
                        }
                        Promise::resolve(&response).unchecked_into::<Promise>()
                    }
                    Err(error) => Promise::reject(&error),
                }
            });
            Reflect::set(&global, &key, handler.as_ref())
                .map_err(|_| NookError::Database("fetch could not be replaced".to_owned()))?;
            Ok(Self {
                calls,
                original,
                _handler: handler,
            })
        }

        /// `METHOD url` of every request, in order.
        pub(crate) fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl Drop for FetchStub {
        fn drop(&mut self) {
            let _restored =
                Reflect::set(&js_sys::global(), &JsString::from("fetch"), &self.original);
        }
    }
}
