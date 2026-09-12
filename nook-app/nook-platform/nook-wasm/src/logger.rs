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
//! - **The web layer** (`$lib/runtime/log`) forwards `createLogger(scope).info(…)`
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
use js_sys::Date;
use nook_core::IsoTimestamp;
use rexie::{ObjectStore, Rexie, TransactionMode};
use serde_wasm_bindgen::from_value;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::{fmt, mem};
use tracing::field::{Field, Visit};
use tracing::{Level, subscriber};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::fmt::format::DefaultFields;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::Registry;
use tracing_subscriber::reload::Layer as ReloadLayer;
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
    fn console_echo_js(level: &str, text: &str) -> Result<(), js_sys::Error>;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogLevel {
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

    fn parse(raw: &str) -> Result<Self, UnrecognizedLogLevel> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "error" => Ok(LogLevel::Error),
            "warn" => Ok(LogLevel::Warn),
            "info" => Ok(LogLevel::Info),
            "debug" => Ok(LogLevel::Debug),
            "trace" => Ok(LogLevel::Trace),
            _ => Err(UnrecognizedLogLevel),
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
            Level::ERROR => LogLevel::Error,
            Level::WARN => LogLevel::Warn,
            Level::INFO => LogLevel::Info,
            Level::DEBUG => LogLevel::Debug,
            Level::TRACE => LogLevel::Trace,
        }
    }
}

#[derive(Debug)]
struct UnrecognizedLogLevel;

/// Metadata retains the existing omitted-property/string wire representation.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum LogMetadata {
    Json(String),
    #[default]
    NoFields,
}
impl LogMetadata {
    fn omitted(&self) -> bool {
        matches!(self, Self::NoFields)
    }
}
enum LogFilterInstallation {
    NotInstalled,
    Installed(Box<dyn Fn(LevelFilter)>),
}
#[derive(Default)]
enum LogScope {
    #[default]
    EventTarget,
    Explicit(String),
}
pub(crate) enum LogThreshold {
    AllLevels,
    Minimum(LogLevel),
}
pub(crate) enum LogPageLimit {
    AllEntries,
    Limited(u32),
}

#[derive(Clone, serde::Serialize, serde::Deserialize, tsify::Tsify)]
#[tsify(into_wasm_abi)]
pub struct LogEntry {
    ts: nook_core::IsoTimestamp,
    level: String,
    scope: String,
    message: String,
    #[serde(skip_serializing_if = "LogMetadata::omitted", default)]
    #[tsify(optional, type = "string")]
    data: LogMetadata,
}

#[wasm_bindgen]
pub struct NookLogEntries(Vec<LogEntry>);

#[wasm_bindgen]
impl NookLogEntries {
    #[wasm_bindgen]
    pub fn to_array(&self) -> Vec<LogEntry> {
        self.0.clone()
    }
}

pub(crate) struct LoggerState {
    level: LogLevel,
    /// Write-behind queue drained by [`log_flush`].
    pending: Vec<LogEntry>,
    /// Setter that moves the reloadable global `tracing` level filter. Boxed to
    /// avoid naming the reload handle's generic type.
    set_filter: LogFilterInstallation,
}

thread_local! {
    static LOGGER: RefCell<LoggerState> = const { RefCell::new(LoggerState {
        level: LogLevel::Info,
        pending: Vec::new(),
        set_filter: LogFilterInstallation::NotInstalled,
    }) };

    /// Guards one-time subscriber installation across HMR / repeated init.
    static INIT_DONE: Cell<bool> = const { Cell::new(false) };
}

impl LogEntry {
    fn now_iso() -> nook_core::IsoTimestamp {
        IsoTimestamp::from_trusted(Date::new_0().to_iso_string().into())
    }
}

/// Push an entry onto the write-behind queue.
/// Named values required by `LoggerState::console_echo`.
#[derive(Clone, Copy)]
pub(crate) struct LoggerConsoleEcho<'a> {
    pub(crate) level: &'a str,
    pub(crate) scope: &'a str,
    pub(crate) message: &'a str,
    pub(crate) data: &'a LogMetadata,
}

/// Named values required by `LoggerState::dump_entries`.
pub(crate) struct LoggerDumpEntries {
    pub(crate) min_level: LogThreshold,
    pub(crate) limit: LogPageLimit,
    pub(crate) offset: u32,
}

/// Named values required by `LoggerState::log_record_entry`.
pub(crate) struct LoggerLogRecordEntry<'a> {
    pub(crate) level: &'a str,
    pub(crate) scope: &'a str,
    pub(crate) message: &'a str,
    pub(crate) data: LogMetadata,
}

/// Named values required by `LoggerState::log_dump_page`.
pub(crate) struct LoggerPage {
    pub(crate) min_level: String,
    pub(crate) limit: u32,
    pub(crate) offset: u32,
}

impl LoggerState {
    fn queue(entry: LogEntry) {
        LOGGER.with(|logger| logger.borrow_mut().pending.push(entry));
    }
}

/// Echo one entry to the console via the JS bridge (original console methods).
impl LoggerState {
    fn console_echo(request: LoggerConsoleEcho<'_>) {
        let LoggerConsoleEcho {
            level,
            scope,
            message,
            data,
        } = request;
        let text = match data {
            LogMetadata::Json(data) => format!("[{scope}] {message} {data}"),
            LogMetadata::NoFields => format!("[{scope}] {message}"),
        };
        drop(console_echo_js(level, &text));
    }
}

/// Collects the `message`, an optional `scope` field, and any remaining fields
/// (rendered as a JSON object) from a `tracing` event.
#[derive(Default)]
struct FieldVisitor {
    message: String,
    scope: LogScope,
    fields: Vec<(String, String)>,
}

impl FieldVisitor {
    fn push(&mut self, name: &str, value: String) {
        match name {
            "message" => self.message = value,
            "scope" => self.scope = LogScope::Explicit(value),
            _ => self.fields.push((name.to_owned(), value)),
        }
    }

    fn data_json(&self) -> Result<LogMetadata, serde_json::Error> {
        if self.fields.is_empty() {
            return Ok(LogMetadata::NoFields);
        }
        let map: BTreeMap<&str, &str> = self
            .fields
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        serde_json::to_string(&map).map(LogMetadata::Json)
    }
}

impl Visit for FieldVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.push(field.name(), value.to_owned());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
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
        let scope = match &visitor.scope {
            LogScope::EventTarget => meta.target().to_owned(),
            LogScope::Explicit(scope) => scope.clone(),
        };
        // String-map serialization failure has historically omitted metadata only.
        // Classify that boundary failure explicitly without exposing event data.
        let data = match visitor.data_json() {
            Ok(data) => data,
            Err(_) => LogMetadata::NoFields,
        };

        LoggerState::console_echo(LoggerConsoleEcho {
            level,
            scope: &scope,
            message: &visitor.message,
            data: &data,
        });
        LoggerState::queue(LogEntry {
            ts: LogEntry::now_iso(),
            level: level.to_owned(),
            scope,
            message: visitor.message,
            data,
        });
    }
}

impl LoggerState {
    async fn logs_db() -> Result<rexie::Rexie, NookError> {
        Rexie::builder(LOG_DB_NAME)
            .version(1)
            .add_object_store(ObjectStore::new(LOG_STORE).auto_increment(true))
            .build()
            .await
            .map_err(|e| NookError::IndexedDb(format!("logs db build error: {:?}", e)))
    }
}

impl LoggerState {
    async fn flush_pending() -> Result<(), NookError> {
        let batch: Vec<LogEntry> =
            LOGGER.with(|logger| mem::take(&mut logger.borrow_mut().pending));
        if batch.is_empty() {
            return Ok(());
        }

        let db = LoggerState::logs_db().await?;
        let transaction = db
            .transaction(&[LOG_STORE], TransactionMode::ReadWrite)
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
}

impl LoggerState {
    async fn dump_entries(request: LoggerDumpEntries) -> Result<Vec<LogEntry>, NookError> {
        let LoggerDumpEntries {
            min_level,
            limit,
            offset,
        } = request;
        LoggerState::flush_pending().await?;

        let db = LoggerState::logs_db().await?;
        let transaction = db
            .transaction(&[LOG_STORE], TransactionMode::ReadOnly)
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

        let max_rank = match min_level {
            LogThreshold::AllLevels => LogLevel::Trace.rank(),
            LogThreshold::Minimum(level) => level.rank(),
        };

        let filtered: Vec<LogEntry> = values
            .into_iter()
            .filter_map(|value| from_value::<LogEntry>(value).ok())
            .filter(|entry| match LogLevel::parse(&entry.level) {
                Ok(level) => level.rank() <= max_rank,
                Err(_) => true,
            })
            .collect();

        // Paginate from the newest end: `offset` skips the most recent entries,
        // `limit` caps how many older ones follow.
        let offset = offset as usize;
        let len = filtered.len();
        let end = len.saturating_sub(offset);
        let start = match limit {
            LogPageLimit::Limited(limit) => end.saturating_sub(limit as usize),
            LogPageLimit::AllEntries => 0,
        };
        filtered
            .get(start..end)
            .map(<[LogEntry]>::to_vec)
            .ok_or_else(|| NookError::Database("Log page bounds were invalid.".to_owned()))
    }
}

/// Install the global `tracing` subscriber (once). Wires a reloadable level
/// filter -> [`IndexedDbLayer`] -> `tracing-web` performance timeline layer,
/// and stashes a setter so [`log_set_level`] can move the filter at runtime.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn log_init() {
    LoggerState::log_init();
}
impl LoggerState {
    fn log_init() {
        if INIT_DONE.with(Cell::get) {
            return;
        }
        INIT_DONE.with(|done| done.set(true));

        let active = LOGGER.with(|logger| logger.borrow().level);
        let (filter, handle) = ReloadLayer::new(active.to_filter());

        let perf = tracing_web::performance_layer().with_details_from_fields(DefaultFields::new());

        let subscriber = Registry::default()
            .with(filter)
            .with(IndexedDbLayer)
            .with(perf);

        // Ignore an existing default (e.g. across HMR reloads); the INIT_DONE guard
        // already prevents re-entrancy on this thread.
        if subscriber::set_global_default(subscriber).is_ok() {
            let setter = Box::new(move |level: LevelFilter| {
                drop(handle.modify(|current| *current = level));
            });
            LOGGER.with(|logger| {
                logger.borrow_mut().set_filter = LogFilterInstallation::Installed(setter);
            });
        }
    }
}

/// Set the active log level (`error` | `warn` | `info` | `debug` | `trace`).
/// Moves the global `tracing` filter and the level used by the web-layer gate.
/// Entries below this level are neither echoed nor persisted.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn log_set_level(level: &str) {
    LoggerState::log_set_level(level);
}
impl LoggerState {
    fn log_set_level(level: &str) {
        if let Ok(level) = LogLevel::parse(level) {
            LOGGER.with(|logger| {
                let mut state = logger.borrow_mut();
                state.level = level;
                if let LogFilterInstallation::Installed(set_filter) = &state.set_filter {
                    set_filter(level.to_filter());
                }
            });
        }
    }
}

/// Return the active log level as a lowercase string.
#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn log_get_level() -> String {
    LoggerState::log_get_level()
}
impl LoggerState {
    fn log_get_level() -> String {
        LOGGER.with(|logger| logger.borrow().level.as_str().to_owned())
    }
}

/// Record one log entry from the web layer (persist-only). Dropped when below
/// the active level; the web layer owns console echo, so nothing is printed
/// here. Otherwise queued for the next [`log_flush`].
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn log_record(level: &str, scope: &str, message: &str) {
    LoggerState::log_record_entry(LoggerLogRecordEntry {
        level,
        scope,
        message,
        data: LogMetadata::NoFields,
    });
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn log_record_with_data(level: &str, scope: &str, message: &str, data: String) {
    LoggerState::log_record_entry(LoggerLogRecordEntry {
        level,
        scope,
        message,
        data: LogMetadata::Json(data),
    });
}

impl LoggerState {
    fn log_record_entry(request: LoggerLogRecordEntry<'_>) {
        let LoggerLogRecordEntry {
            level,
            scope,
            message,
            data,
        } = request;
        let level = LogLevel::parse(level).unwrap_or(LogLevel::Info);
        let active = LOGGER.with(|logger| logger.borrow().level);
        if level.rank() > active.rank() {
            return;
        }
        LoggerState::queue(LogEntry {
            ts: LogEntry::now_iso(),
            level: level.as_str().to_owned(),
            scope: scope.to_owned(),
            message: message.to_owned(),
            data,
        });
    }
}

/// Flush the in-memory queue to `IndexedDB`. Called on an interval by the web
/// layer; safe to call concurrently (each call drains the current batch).
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn log_flush() -> Result<(), wasm_bindgen::JsError> {
    LoggerState::log_flush().await
}
impl LoggerState {
    async fn log_flush() -> Result<(), wasm_bindgen::JsError> {
        LoggerState::flush_pending().await?;
        Ok(())
    }
}

/// Read persisted entries (oldest first), filtered by minimum level and
/// paginated from the newest end. Returns an array of
/// `{ ts, level, scope, message, data? }`.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn log_dump() -> Result<NookLogEntries, wasm_bindgen::JsError> {
    LoggerState::log_dump().await
}
impl LoggerState {
    async fn log_dump() -> Result<NookLogEntries, wasm_bindgen::JsError> {
        let entries = LoggerState::dump_entries(LoggerDumpEntries {
            min_level: LogThreshold::AllLevels,
            limit: LogPageLimit::AllEntries,
            offset: 0,
        })
        .await?;
        Ok(NookLogEntries(entries))
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: accepts log pagination limits and offsets as JavaScript Number scalars"
    )
)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn log_dump_page(
    min_level: String,
    limit: u32,
    offset: u32,
) -> Result<NookLogEntries, wasm_bindgen::JsError> {
    LoggerState::log_dump_page(LoggerPage {
        min_level,
        limit,
        offset,
    })
    .await
}
impl LoggerState {
    async fn log_dump_page(request: LoggerPage) -> Result<NookLogEntries, wasm_bindgen::JsError> {
        let LoggerPage {
            min_level,
            limit,
            offset,
        } = request;
        let entries = LoggerState::dump_entries(LoggerDumpEntries {
            min_level: match LogLevel::parse(&min_level) {
                Ok(level) => LogThreshold::Minimum(level),
                Err(_) => LogThreshold::AllLevels,
            },
            limit: LogPageLimit::Limited(limit),
            offset,
        })
        .await?;
        Ok(NookLogEntries(entries))
    }
}

/// Total number of persisted log entries (after flushing the queue).
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the persisted log count as a JavaScript Number scalar"
    )
)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn log_count() -> Result<u32, wasm_bindgen::JsError> {
    LoggerState::log_count().await
}
impl LoggerState {
    async fn log_count() -> Result<u32, wasm_bindgen::JsError> {
        LoggerState::flush_pending().await?;
        let db = LoggerState::logs_db().await?;
        let transaction = db
            .transaction(&[LOG_STORE], TransactionMode::ReadOnly)
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
}

/// Drop the in-memory queue and clear the persisted log store.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn log_clear() -> Result<(), wasm_bindgen::JsError> {
    LoggerState::log_clear().await
}
impl LoggerState {
    async fn log_clear() -> Result<(), wasm_bindgen::JsError> {
        LOGGER.with(|logger| logger.borrow_mut().pending.clear());
        let db = LoggerState::logs_db().await?;
        let transaction = db
            .transaction(&[LOG_STORE], TransactionMode::ReadWrite)
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
}

impl LoggerState {
    pub(crate) async fn clear_logs_db() -> Result<(), NookError> {
        LOGGER.with(|logger| logger.borrow_mut().pending.clear());
        let db = LoggerState::logs_db().await?;
        let transaction = db
            .transaction(&[LOG_STORE], TransactionMode::ReadWrite)
            .map_err(|e| NookError::IndexedDb(format!("logs clear transaction error: {e:?}")))?;
        transaction
            .store(LOG_STORE)
            .map_err(|e| NookError::IndexedDb(format!("logs clear store error: {e:?}")))?
            .clear()
            .await
            .map_err(|e| NookError::IndexedDb(format!("logs clear error: {e:?}")))?;
        transaction
            .done()
            .await
            .map_err(|e| NookError::IndexedDb(format!("logs clear completion error: {e:?}")))?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn logger_persists_filters_pages_and_clears_entries() -> Result<(), wasm_bindgen::JsError>
    {
        log_clear().await?;
        log_set_level("debug");
        assert_eq!(log_get_level(), "debug");

        log_record("trace", "filtered", "not persisted");
        log_record("info", "sync", "started");
        log_record_with_data("warn", "sync", "retrying", r#"{"attempt":2}"#.to_owned());
        log_flush().await?;

        assert_eq!(log_count().await?, 2);
        let entries = log_dump().await?.to_array();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].level, "info");
        assert_eq!(entries[1].level, "warn");

        let page = log_dump_page("warn".to_owned(), 1, 0).await?.to_array();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].message, "retrying");

        log_clear().await?;
        assert_eq!(log_count().await?, 0);
        Ok(())
    }
}
