//! Leveled application logger owned by WASM and persisted in `IndexedDB` (rexie).
//!
//! This is the single source of truth for Nook's application logging. The web
//! layer (`$lib/log`) is a thin shim that forwards `createLogger(scope).info(…)`
//! calls to [`log_record`] and drives the periodic [`log_flush`].
//!
//! Persistence is **level-gated**: only entries at or above the active level
//! (set via [`log_set_level`]) are echoed to the console and appended to the
//! `nook_logs` `IndexedDB` database (ring buffer, newest ~[`LOG_MAX_ENTRIES`]
//! kept). To capture more detail for a post-mortem, lower the level (e.g.
//! `debug`/`trace`) and reproduce — nothing below the threshold is stored.
//!
//! Appends are buffered in memory and written behind a JS-driven flush so
//! logging never blocks or throws into callers.

use crate::NookError;
use std::cell::RefCell;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

const LOG_DB_NAME: &str = "nook_logs";
const LOG_STORE: &str = "logs";
/// Keep at most this many entries persisted (oldest trimmed first).
const LOG_MAX_ENTRIES: u32 = 5000;
/// Extra slack so trimming runs in batches, not on every append.
const LOG_TRIM_SLACK: u32 = 500;

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
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct LogEntry {
    ts: String,
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
}

thread_local! {
    static LOGGER: RefCell<LoggerState> = const {
        RefCell::new(LoggerState {
            level: LogLevel::Info,
            pending: Vec::new(),
        })
    };
}

fn now_iso() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}

fn console_echo(entry: &LogEntry) {
    let line = format!("[{}] {}", entry.scope, entry.message);
    let text = match &entry.data {
        Some(data) => format!("{line} {data}"),
        None => line,
    };
    let value = JsValue::from_str(&text);
    match LogLevel::parse(&entry.level) {
        Some(LogLevel::Error) => web_sys::console::error_1(&value),
        Some(LogLevel::Warn) => web_sys::console::warn_1(&value),
        _ => web_sys::console::log_1(&value),
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

/// Set the active log level (`error` | `warn` | `info` | `debug` | `trace`).
/// Entries below this level are neither echoed nor persisted.
#[wasm_bindgen(js_name = nookLogSetLevel)]
pub fn log_set_level(level: &str) {
    if let Some(level) = LogLevel::parse(level) {
        LOGGER.with(|logger| logger.borrow_mut().level = level);
    }
}

/// Return the active log level as a lowercase string.
#[wasm_bindgen(js_name = nookLogGetLevel)]
#[must_use]
pub fn log_get_level() -> String {
    LOGGER.with(|logger| logger.borrow().level.as_str().to_owned())
}

/// Record one log entry. Dropped when below the active level; otherwise echoed
/// to the console and queued for the next [`log_flush`].
#[wasm_bindgen(js_name = nookLog)]
pub fn log_record(level: &str, scope: &str, message: &str, data: Option<String>) {
    let level = LogLevel::parse(level).unwrap_or(LogLevel::Info);
    let active = LOGGER.with(|logger| logger.borrow().level);
    if level.rank() > active.rank() {
        return;
    }
    let entry = LogEntry {
        ts: now_iso(),
        level: level.as_str().to_owned(),
        scope: scope.to_owned(),
        message: message.to_owned(),
        data,
    };
    console_echo(&entry);
    LOGGER.with(|logger| logger.borrow_mut().pending.push(entry));
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
