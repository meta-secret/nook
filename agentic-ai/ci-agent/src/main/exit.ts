import { execFileSync } from "node:child_process";

/**
 * Force process exit for one-shot CI runs.
 *
 * The Cursor SDK local executor can leave child processes and open handles
 * (HTTP clients, SQLite stores, timers) after agent disposal. Node then keeps
 * the event loop alive and the job hangs even after the harness logs success —
 * see run 28426404515 (merged at 07:27, cancelled at 08:11 with orphan
 * `task`/`node` children).
 *
 * Kill direct children first, then `process.exit` so open handles cannot keep
 * the event loop alive. Do not signal the whole process group — that SIGTERMs
 * this process and turns a successful run into exit 143.
 */
export function exitCiAgent(code: number): never {
  try {
    const stdout = execFileSync("pgrep", ["-P", String(process.pid)], {
      encoding: "utf8",
    });
    for (const line of stdout.split("\n")) {
      const childPid = Number(line.trim());
      if (!Number.isInteger(childPid) || childPid <= 0) {
        continue;
      }
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Child may have already exited.
      }
    }
  } catch {
    // pgrep exits 1 when there are no children.
  }
  process.exit(code);
}
