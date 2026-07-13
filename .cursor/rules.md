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
- **No user master passphrase.** DEC is auto-generated on first connect and stored in the vault `auth:` section (encrypted to the device key). Device identity lives in IndexedDB (`device_identity_secret`). Never expose a passphrase input in the UI.
- **Secret key stays in the browser.** The encryption key is never written to GitHub — only the encrypted vault file (`nook-vault.yaml`) is synced remotely.
- **GitHub mode requires only a PAT** with `repo` scope. Repository and vault file are resolved automatically: `{username}/nook/nook-vault.yaml`.
- **Local mode requires no credentials.** Each projection cache lives in IndexedDB under `vault:{store_id}`.

### Get started paths
- **Three mutually exclusive first-run intents:** Create Simple vault, Create Sentinel vault, Join Sentinel setup. Do not collapse create/join into one vault-type dropdown with footer links.
- **Sync-provider import is secondary** (“already have a vault”), not a create/join path.
- **Sentinel create** chooses `N`/`T`, waits for all participant public keys, then atomically creates an empty vault. See `.cortex/design-docs/sentinel-genesis.md`.
- **Sentinel join** primarily shares standalone public keys with the vault owner; initiator request is optional (session-bound response or share delivery only). Post-genesis share delivery and later Onboard+sync QR are separate steps.
- Source of truth: `.cortex/design-docs/vault-architecture-modes.md` and issue #303.

### Package boundaries
- Dependency flow is strictly `nook-core` → `nook-wasm` → `nook-web`. Never reverse this.
- Crypto, vault YAML format, validation, password generation, search filtering, and shared domain models belong in `nook-core` with Rust tests. Storage I/O (IndexedDB, GitHub API) belongs in `nook-wasm`. UI and reactive state belong in `nook-web`.
- `nook-core` may expose simple DTOs/enums with `wasm-bindgen` so web code consumes the typed core model directly. Browser APIs, IndexedDB, HTTP, JS promises, and session state still belong outside core.

### WASM API contract
- `NookVaultManager.connect(storage_mode, github_pat)` — two arguments only.
- After changing `nook-wasm`, rebuild bindings: `task wasm:build` (or `task build`).

### Tooling
- Use `task` commands (via Docker) for build, check, format, and test. Do not run raw compiler commands unless debugging.
- Keep changes minimal and scoped. Match existing naming, patterns, and file structure.

### Git
- Never push directly to `main`. Always work on a feature branch and open a pull request. See `.cortex/rules.md` §6.
- **Squash merge only.** Every PR merged into `main` MUST use squash merge (`gh pr merge --squash` or GitHub **Squash and merge**). Never merge commit or rebase merge. See `.cortex/workflows/pull-requests.md`.
