//! Leveled application logger owned by WASM and persisted in `IndexedDB` (rexie).
//!
//! This is the single source of truth for Nook's application logging. It is
//! built on the [`tracing`] ecosystem so that domain logic in `nook-core` can
//! emit structured events (`tracing::debug!/warn!/error!`) that land in the
//! same store as web-layer logs.
//!
//! Two producers feed one persistence queue:
//! - **Rust `tracing` events** flow through a reloadable global level filter
//!   into [`IndexedDbLayer`], which appends a [`LogEntry`] and echoes to the
//!   console via the JS `window.__nookConsole` bridge.
//! - **The web layer** (`$lib/log`) forwards `createLogger(scope).info(…)`
//!   calls to [`log_record`] (persist-only; the web layer owns console echo).
//!
//! Persistence is **level-gated**: only entries at or above the active level
//! (set via [`log_set_level`]) are echoed and appended to the `nook_logs`
//! `IndexedDB` database (ring buffer, newest ~[`LOG_MAX_ENTRIES`] kept). To
//! capture more detail for a post-mortem, lower the level (e.g. `debug`/`trace`)
//! and reproduce — nothing below the threshold is stored.
//!
//! Appends are buffered in memory and written behind a JS-driven flush so
//! logging never blocks or throws into callers.

use crate::NookError;
use std::cell::{Cell, RefCell};
use tracing::field::{Field, Visit};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::Registry;
use tracing_subscriber::reload;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

const LOG_DB_NAME: &str = "nook_logs";
const LOG_STORE: &str = "logs";
/// Keep at most this many entries persisted (oldest trimmed first).
const LOG_MAX_ENTRIES: u32 = 5000;
/// Extra slack so trimming runs in batches, not on every append.
const LOG_TRIM_SLACK: u32 = 500;

#[wasm_bindgen]
extern "C" {
    /// Echo a line to the browser console using the ORIGINAL (unpatched)
    /// `console.*` methods captured by the web layer. Guarded with `catch` so
    /// calls before the bridge is installed are silently ignored.
    #[wasm_bindgen(catch, js_namespace = ["window", "__nookConsole"], js_name = echo)]
    fn console_echo_js(level: &str, text: &str) -> Result<(), JsValue>;
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    fn rank(self) -> u8 {
        match self {
            LogLevel::Error => 0,
            LogLevel::Warn => 1,
            LogLevel::Info => 2,
            LogLevel::Debug => 3,
            LogLevel::Trace => 4,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
            LogLevel::Trace => "trace",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "error" => Some(LogLevel::Error),
            "warn" => Some(LogLevel::Warn),
            "info" => Some(LogLevel::Info),
            "debug" => Some(LogLevel::Debug),
            "trace" => Some(LogLevel::Trace),
            _ => None,
        }
    }

    /// Map to the `tracing` level filter used by the reloadable global filter.
    fn to_filter(self) -> LevelFilter {
        match self {
            LogLevel::Error => LevelFilter::ERROR,
            LogLevel::Warn => LevelFilter::WARN,
            LogLevel::Info => LevelFilter::INFO,
            LogLevel::Debug => LevelFilter::DEBUG,
            LogLevel::Trace => LevelFilter::TRACE,
        }
    }

    fn from_tracing(level: tracing::Level) -> LogLevel {
        match level {
            tracing::Level::ERROR => LogLevel::Error,
            tracing::Level::WARN => LogLevel::Warn,
            tracing::Level::INFO => LogLevel::Info,
            tracing::Level::DEBUG => LogLevel::Debug,
            tracing::Level::TRACE => LogLevel::Trace,
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct LogEntry {
    ts: nook_core::IsoTimestamp,
    level: String,
    scope: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    data: Option<String>,
}

struct LoggerState {
    level: LogLevel,
    /// Write-behind queue drained by [`log_flush`].
    pending: Vec<LogEntry>,
    /// Setter that moves the reloadable global `tracing` level filter. Boxed to
    /// avoid naming the reload handle's generic type.
    set_filter: Option<Box<dyn Fn(LevelFilter)>>,
}

thread_local! {
    static LOGGER: RefCell<LoggerState> = RefCell::new(LoggerState {
        level: LogLevel::Info,
        pending: Vec::new(),
        set_filter: None,
    });

    /// Guards one-time subscriber installation across HMR / repeated init.
    static INIT_DONE: Cell<bool> = const { Cell::new(false) };
}

fn now_iso() -> nook_core::IsoTimestamp {
    nook_core::IsoTimestamp::from_trusted(js_sys::Date::new_0().to_iso_string().into())
}

/// Push an entry onto the write-behind queue.
fn queue(entry: LogEntry) {
    LOGGER.with(|logger| logger.borrow_mut().pending.push(entry));
}

/// Echo one entry to the console via the JS bridge (original console methods).
fn console_echo(level: &str, scope: &str, message: &str, data: Option<&str>) {
    let text = match data {
        Some(data) => format!("[{scope}] {message} {data}"),
        None => format!("[{scope}] {message}"),
    };
    let _ = console_echo_js(level, &text);
}

/// Collects the `message`, an optional `scope` field, and any remaining fields
/// (rendered as a JSON object) from a `tracing` event.
#[derive(Default)]
struct FieldVisitor {
    message: String,
    scope: Option<String>,
    fields: Vec<(String, String)>,
}

impl FieldVisitor {
    fn push(&mut self, name: &str, value: String) {
        match name {
            "message" => self.message = value,
            "scope" => self.scope = Some(value),
            _ => self.fields.push((name.to_owned(), value)),
        }
    }

    fn data_json(&self) -> Option<String> {
        if self.fields.is_empty() {
            return None;
        }
        let map: serde_json::Map<String, serde_json::Value> = self
            .fields
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        serde_json::to_string(&serde_json::Value::Object(map)).ok()
    }
}

impl Visit for FieldVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.push(field.name(), value.to_owned());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.push(field.name(), format!("{value:?}"));
    }
}

/// `tracing` layer that turns each event into a persisted [`LogEntry`] and
/// echoes it to the console. Level gating is handled by the global reload
/// filter installed above this layer, so no re-check is needed here.
struct IndexedDbLayer;

impl<S: tracing::Subscriber> Layer<S> for IndexedDbLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let meta = event.metadata();
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);

        let level = LogLevel::from_tracing(*meta.level()).as_str();
        let scope = visitor
            .scope
            .clone()
            .unwrap_or_else(|| meta.target().to_owned());
        let data = visitor.data_json();

        console_echo(level, &scope, &visitor.message, data.as_deref());
        queue(LogEntry {
            ts: now_iso(),
            level: level.to_owned(),
            scope,
            message: visitor.message,
            data,
        });
    }
}

async fn logs_db() -> Result<rexie::Rexie, NookError> {
    rexie::Rexie::builder(LOG_DB_NAME)
        .version(1)
        .add_object_store(rexie::ObjectStore::new(LOG_STORE).auto_increment(true))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs db build error: {:?}", e)))
}

async fn flush_pending() -> Result<(), NookError> {
    let batch: Vec<LogEntry> =
        LOGGER.with(|logger| std::mem::take(&mut logger.borrow_mut().pending));
    if batch.is_empty() {
        return Ok(());
    }

    let db = logs_db().await?;
    let transaction = db
        .transaction(&[LOG_STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("logs transaction error: {:?}", e)))?;
    let store = transaction
        .store(LOG_STORE)
        .map_err(|e| NookError::IndexedDb(format!("logs store error: {:?}", e)))?;

    for entry in &batch {
        let value = serde_wasm_bindgen::to_value(entry)
            .map_err(|e| NookError::IndexedDb(format!("logs serialize error: {:?}", e)))?;
        store
            .add(&value, None)
            .await
            .map_err(|e| NookError::IndexedDb(format!("logs add error: {:?}", e)))?;
    }

    let count = store
        .count(None)
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs count error: {:?}", e)))?;
    if count > LOG_MAX_ENTRIES + LOG_TRIM_SLACK {
        let excess = count - LOG_MAX_ENTRIES;
        let keys = store
            .get_all_keys(None, Some(excess))
            .await
            .map_err(|e| NookError::IndexedDb(format!("logs keys error: {:?}", e)))?;
        for key in keys {
            store
                .delete(key)
                .await
                .map_err(|e| NookError::IndexedDb(format!("logs delete error: {:?}", e)))?;
        }
    }

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs transaction done error: {:?}", e)))?;
    Ok(())
}

async fn dump_entries(
    min_level: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<LogEntry>, NookError> {
    flush_pending().await?;

    let db = logs_db().await?;
    let transaction = db
        .transaction(&[LOG_STORE], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("logs transaction error: {:?}", e)))?;
    let store = transaction
        .store(LOG_STORE)
        .map_err(|e| NookError::IndexedDb(format!("logs store error: {:?}", e)))?;
    let values = store
        .get_all(None, None)
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs get_all error: {:?}", e)))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs transaction done error: {:?}", e)))?;

    let max_rank = min_level
        .as_deref()
        .and_then(LogLevel::parse)
        .unwrap_or(LogLevel::Trace)
        .rank();

    let filtered: Vec<LogEntry> = values
        .into_iter()
        .filter_map(|value| serde_wasm_bindgen::from_value::<LogEntry>(value).ok())
        .filter(|entry| LogLevel::parse(&entry.level).is_none_or(|level| level.rank() <= max_rank))
        .collect();

    // Paginate from the newest end: `offset` skips the most recent entries,
    // `limit` caps how many older ones follow.
    let offset = offset.unwrap_or(0) as usize;
    let len = filtered.len();
    let end = len.saturating_sub(offset);
    let start = match limit {
        Some(limit) => end.saturating_sub(limit as usize),
        None => 0,
    };
    Ok(filtered[start..end].to_vec())
}

/// Install the global `tracing` subscriber (once). Wires a reloadable level
/// filter -> [`IndexedDbLayer`] -> `tracing-web` performance timeline layer,
/// and stashes a setter so [`log_set_level`] can move the filter at runtime.
#[wasm_bindgen(js_name = nookLogInit)]
pub fn log_init() {
    if INIT_DONE.with(Cell::get) {
        return;
    }
    INIT_DONE.with(|done| done.set(true));

    let active = LOGGER.with(|logger| logger.borrow().level);
    let (filter, handle) = reload::Layer::new(active.to_filter());

    let perf = tracing_web::performance_layer()
        .with_details_from_fields(tracing_subscriber::fmt::format::DefaultFields::new());

    let subscriber = Registry::default()
        .with(filter)
        .with(IndexedDbLayer)
        .with(perf);

    // Ignore an existing default (e.g. across HMR reloads); the INIT_DONE guard
    // already prevents re-entrancy on this thread.
    if tracing::subscriber::set_global_default(subscriber).is_ok() {
        let setter = Box::new(move |level: LevelFilter| {
            let _ = handle.modify(|current| *current = level);
        });
        LOGGER.with(|logger| logger.borrow_mut().set_filter = Some(setter));
    }
}

/// Set the active log level (`error` | `warn` | `info` | `debug` | `trace`).
/// Moves the global `tracing` filter and the level used by the web-layer gate.
/// Entries below this level are neither echoed nor persisted.
#[wasm_bindgen(js_name = nookLogSetLevel)]
pub fn log_set_level(level: &str) {
    if let Some(level) = LogLevel::parse(level) {
        LOGGER.with(|logger| {
            let mut state = logger.borrow_mut();
            state.level = level;
            if let Some(set_filter) = state.set_filter.as_ref() {
                set_filter(level.to_filter());
            }
        });
    }
}

/// Return the active log level as a lowercase string.
#[wasm_bindgen(js_name = nookLogGetLevel)]
#[must_use]
pub fn log_get_level() -> String {
    LOGGER.with(|logger| logger.borrow().level.as_str().to_owned())
}

/// Record one log entry from the web layer (persist-only). Dropped when below
/// the active level; the web layer owns console echo, so nothing is printed
/// here. Otherwise queued for the next [`log_flush`].
#[wasm_bindgen(js_name = nookLog)]
pub fn log_record(level: &str, scope: &str, message: &str, data: Option<String>) {
    let level = LogLevel::parse(level).unwrap_or(LogLevel::Info);
    let active = LOGGER.with(|logger| logger.borrow().level);
    if level.rank() > active.rank() {
        return;
    }
    queue(LogEntry {
        ts: now_iso(),
        level: level.as_str().to_owned(),
        scope: scope.to_owned(),
        message: message.to_owned(),
        data,
    });
}

/// Flush the in-memory queue to `IndexedDB`. Called on an interval by the web
/// layer; safe to call concurrently (each call drains the current batch).
#[wasm_bindgen(js_name = nookLogFlush)]
pub async fn log_flush() -> Result<(), wasm_bindgen::JsError> {
    flush_pending().await?;
    Ok(())
}

/// Read persisted entries (oldest first), filtered by minimum level and
/// paginated from the newest end. Returns an array of
/// `{ ts, level, scope, message, data? }`.
#[wasm_bindgen(js_name = nookLogDump)]
pub async fn log_dump(
    min_level: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let entries = dump_entries(min_level, limit, offset).await?;
    Ok(serde_wasm_bindgen::to_value(&entries)?)
}

/// Total number of persisted log entries (after flushing the queue).
#[wasm_bindgen(js_name = nookLogCount)]
pub async fn log_count() -> Result<u32, wasm_bindgen::JsError> {
    flush_pending().await?;
    let db = logs_db().await?;
    let transaction = db
        .transaction(&[LOG_STORE], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("logs transaction error: {:?}", e)))?;
    let store = transaction
        .store(LOG_STORE)
        .map_err(|e| NookError::IndexedDb(format!("logs store error: {:?}", e)))?;
    let count = store
        .count(None)
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs count error: {:?}", e)))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs transaction done error: {:?}", e)))?;
    Ok(count)
}

/// Drop the in-memory queue and clear the persisted log store.
#[wasm_bindgen(js_name = nookLogClear)]
pub async fn log_clear() -> Result<(), wasm_bindgen::JsError> {
    LOGGER.with(|logger| logger.borrow_mut().pending.clear());
    let db = logs_db().await?;
    let transaction = db
        .transaction(&[LOG_STORE], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("logs transaction error: {:?}", e)))?;
    let store = transaction
        .store(LOG_STORE)
        .map_err(|e| NookError::IndexedDb(format!("logs store error: {:?}", e)))?;
    store
        .clear()
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs clear error: {:?}", e)))?;
    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("logs transaction done error: {:?}", e)))?;
    Ok(())
}
