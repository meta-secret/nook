# Cursor Rules

Before working on any task, load and follow the instructions in these files:

1. `.cortex/AGENTS.md` — entry point and table of contents
2. `.cortex/ARCHITECTURE.md` — project shape, packages, commands
3. `.cortex/rules.md` — golden principles and hard constraints
4. `.cortex/design-docs/index.md` — design docs and operating beliefs
5. `.cortex/product-specs/index.md` — product requirements and specifications
6. `.cortex/exec-plans/tech-debt-tracker.md` — execution plans and refactoring status

These files are the source of truth for how this project works.

---

## Domain Invariants (do not regress)

### Authentication & storage
- **No user master passphrase.** Encryption keys are auto-generated on first connect and stored in IndexedDB (`vault_secret_key` via `rexie`). Never expose a passphrase input in the UI.
- **Secret key stays in the browser.** The encryption key is never written to GitHub — only the encrypted vault file (`nook-vault.yaml`) is synced remotely.
- **GitHub mode requires only a PAT** with `repo` scope. Repository and vault file are resolved automatically: `{username}/nook/nook-vault.yaml`.
- **Local mode requires no credentials.** The encrypted vault lives in IndexedDB under `encrypted_db`.

### Package boundaries
- Dependency flow is strictly `nook-core` → `nook-wasm` → `nook-web`. Never reverse this.
- Crypto and vault format logic belong in `nook-core`. Storage I/O (IndexedDB, GitHub API) belongs in `nook-wasm`. UI and reactive state belong in `nook-web`.

### WASM API contract
- `NookVaultManager.connect(storage_mode, github_pat)` — two arguments only.
- After changing `nook-wasm`, rebuild bindings: `task wasm:build` (or `task build`).

### Tooling
- Use `task` commands (via Docker) for build, check, format, and test. Do not run raw compiler commands unless debugging.
- Keep changes minimal and scoped. Match existing naming, patterns, and file structure.
