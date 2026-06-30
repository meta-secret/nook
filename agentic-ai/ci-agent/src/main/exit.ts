/**
 * Force process exit for one-shot CI runs.
 *
 * The Cursor SDK local executor can leave child processes and open handles
 * (HTTP clients, SQLite stores, timers) after `await using agent` disposal.
 * Node then keeps the event loop alive and the `ci-fix` job hangs even after
 * `runCiFix()` logs success — see run 28426404515 (merged at 07:27, cancelled
 * at 08:11 with orphan `task`/`node` children).
 */
export function exitCiAgent(code: number): never {
  process.exit(code);
}
