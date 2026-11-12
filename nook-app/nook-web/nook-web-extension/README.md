# Nook Browser Extension

`nook-web-extension` is Nook's browser-integration package. The toolbar icon
opens the extension's side panel, docked at full height beside the page and
open across tab switches. The panel sets up and unlocks the extension device in
place with a PIN or passkey, through the same ceremony as the authentication
tab. It lists the current site's saved items in one section per connected
identity and vault. Each login has an explicit Fill. The panel also offers Open
vault and Lock. Connecting an identity opens, or reuses, one Nook tab on the
Simple Vault connect route in the panel's window. Creating a first vault,
joining with an existing identity, and choosing the identity to connect all
happen on that page, and the panel shows its current step until the identity is
approved or the tab closes. All connections is a page of the panel itself,
with Make default and Use this identity. A locked Pilot widget offers
Unlock, which opens the side panel. Connect vault from a Pilot widget opens or
focuses the pairing auth tab in the initiating normal window. If
another auth intent is already open, it is left untouched and the requested
intent opens in a separate tab in that window. Pairing from that tab sends the
public device request directly to the configured Simple Vault deployment,
which owns the complete vault interface. The extension contains
browser-only behavior: device protection, the in-page **Nook Pilot**
authentication HUD, minimal DOM observation/fill integration, and background
coordination. The HUD reports the current Rust-classified authentication
workflow, progress, site context, next approved action, and manual takeover
without becoming a second vault interface.

On OTP challenges, the same widget detects standard one-time-code fields. It
asks the unlocked Rust/WASM session for safe authenticator labels, requires the
user to choose one, and fills the freshly derived code without persisting or
logging it. If the vault has none, the widget says so and offers to open Simple
Vault to add 2FA.

On authenticator setup pages, the Pilot can offer **Add 2FA from this page** and
**Save backup codes**. Those actions run only after a trusted click: QR decode,
setup-key reading, and recovery-code extraction stay local, Rust/WASM validates the payload, and
the user confirms before any vault write. Cancelling clears transient secrets
and writes no event.

For ordinary websites, the extension also provides explicit passkey save and
use prompts. It intercepts non-conditional WebAuthn create/get calls, asks the
user to choose a granted Simple Vault/account, and delegates validation,
ES256 key generation, signing, and counter persistence to Rust/WASM. The user
can always choose the browser or a security key instead. Locked, unavailable,
or account-less Nook sessions automatically use that native fallback.

After a passkey or PIN authorization, the extension keeps its decrypted device
identity only in an offscreen extension document under a 15-minute lease.
Status, read, retry, and closing or reopening the side panel or
authentication tab do not renew it. Reopening
either during a live lease remains unlocked. Lease expiry, explicit lock, or
browser/context restart requires reauthentication. This preserves required
prompts rather than reducing them. The identity is never written to browser-vendor storage.

The extension first-run model is specified in
[`nook-app/nook-web/nook-web-extension/.cortex/docs/spec/browser-extension.md`](.cortex/docs/spec/browser-extension.md).
The extension becomes its own passkey-protected Nook device and pairs only
through vault consent at the configured Simple Vault
`/extension-connect` route; it does not borrow or scrape the Simple web app
device key. There is no website-first enable screen, floating companion
window, or toolbar popup. The side panel runs the device passkey and PIN
ceremonies itself, and opening another page never closes it. The auth tab also
displays localized return guidance after a Pilot unlock; the page HUD waits for
a fresh Continue click and rechecks the current origin/workflow before it acts.
It intentionally has no miniature vault interface: the side panel shows only
non-secret login metadata for the current site, and its Fill never submits a
form. Sentinel Vault
is excluded by the manifest, runtime guard, pairing validation, and Rust/WASM
capability checks.

Approval copies the canonical encrypted, signed event log into the extension's
own IndexedDB through a Rust/WASM-validated runtime message. The extension is
marked connected only when that graph contains a current approval and encrypted
key envelope for its passkey-protected device. Afterward, Simple Vault sends the
same encrypted projection after local changes and provider pulls, so local
website/extension updates do not require a sync provider. Pairing metadata,
provider grants, and encrypted vault data all remain in extension-origin
IndexedDB. The manifest's browser storage permission supports transient session
coordination only; Rexie is the pairing persistence boundary.

Build it through Docker-backed Taskfile commands from the repo root or `nook-app/`:

```bash
task extension:build
```

Each build pairs with exactly one Simple vault. `VAULT` names it: `nokey`
(`https://simple.nokey.sh/`, the default), `meta-secret`
(`https://simple.meta-secret.io/`), `localhost`
(`https://localhost:5173/`), or an absolute Simple vault URL. Builders read
the same value from `NOOK_EXTENSION_VAULT`, and an unknown name fails the
build. The extension identity follows the channel and defaults to production;
the `meta-secret` target adds its own identity beside the channel's.
CI selects the matching vault and deterministic identity for PR and development
deployments. Override both for an ad hoc PR build, or use the local task:

```bash
task extension:build VAULT=meta-secret
NOOK_EXTENSION_CHANNEL=pr-408 \
  task extension:build VAULT=https://pr-408.nokey-simple.pages.dev/
task extension:build:localhost
```

PR CI publishes the ZIP at
`https://pr-<number>.nokey-sh.pages.dev/downloads/nook-passwords-pr-<number>.zip`.
Main publishes the development ZIP at
`https://dev.nokey.sh/downloads/nook-passwords-dev.zip`, paired only with
`https://simple.dev.nokey.sh/`. Production releases publish a versioned ZIP at
`https://nokey.sh/downloads/` and attach the same bytes to the GitHub Release.
They also publish a manual-install production ZIP paired only with
`https://simple.meta-secret.io/`, with its own extension identity so it installs
beside the default package. It is named
`nook-passwords-meta-secret-<version>.zip` and described by
`extension-meta-secret.json` and its `.sha256`. These files ship in the Simple
vault artifact, so `https://simple.meta-secret.io/downloads/` serves them, and
the release attaches both packages' files to the GitHub Release.
Every channel also exposes `/downloads/extension.json` and the archive's
`.sha256` file. Metadata schema version 2 distinguishes the public installation
path from the downloadable verification artifact: production's `install_url`
opens the Chrome Web Store listing derived from the stable extension ID, while
development and PR channels use their same-origin ZIP with manual installation.

The build writes a Manifest V3 extension bundle to `nook-app/nook-web/nook-web-extension/dist` inside
the sealed Docker image. Use `task docker:extract:extension` to copy that bundle
to the host for manual browser loading.

For a distributable zip with `manifest.json` at the archive root:

```bash
task extension:package
```

For a local release copy, including both the unpacked extension and the zip:

```bash
task extension:install:local
```

That writes to:

- `~/Library/Application Support/Nook/browser-extensions/nook-web-extension/current`
- `~/Library/Application Support/Nook/browser-extensions/nook-web-extension/releases/nook-web-extension-<version>.zip`

Run the Chromium extension e2e suite with:

```bash
task extension:test:e2e
```

That suite includes:

- Detection/smoke coverage against a local **client-side mock auth SPA**
  (`e2e/mock-auth/`, Svelte pages + static host) for plain login, login→2FA, and
  DOM quirks (hidden header password, SPA step-up, standalone OTP, etc.).
  Auth quirks run in the browser; TOTP verify uses `nook-core` via WASM.
- PIN-initialized Pilot flows (`e2e/mock-auth-pilot.spec.ts`) that force
  passkey unavailability, protect the extension device with PIN `123456`, pair
  a vault, and complete Continue with Nook / Fill 2FA against mock auth — no
  real third-party sites.
- Expanded PIN Pilot coverage (`e2e/mock-auth-pilot-coverage.spec.ts`):
  multi-login chooser, no-match / empty 2FA, quirk fill-to-success, wrong
  password evidence, lock mid-flow, and multi-authenticator chooser (#547).

Tracked as #534 (service #535, PIN Pilot e2e #536) and #547.

To test the exact extension ZIP deployed by development or a PR, run the
disposable hosted smoke. It verifies the hosted metadata, checksum, archive,
manifest identity, and channel origins before launching Chromium. The smoke
uses a fresh browser profile to create and pair a local `test-vault`, adds a
login, fills a controlled login page, and verifies unlock after a browser
restart. The profile and vault state are removed when the command exits:

```bash
task extension:smoke:hosted CHANNEL=dev
task extension:smoke:hosted PR=410
```

Production is intentionally rejected because the smoke creates vault data.

For a persistent Brave developer bootstrap that does the full pairing flow
(install → PIN device protection → create Simple Vault → approve extension) and
leaves Brave open on the channel profile, use:

```bash
task extension:setup:brave CHANNEL=dev
task extension:setup:brave PR=410
# Optional:
# Defaults: NOOK_EXTENSION_SETUP_PIN=123456
#           NOOK_EXTENSION_SETUP_VAULT_NAME=test
```

This uses PIN instead of an OS passkey so the ceremony is scriptable. Re-running
revalidates extension pairing storage so a stale setup marker is repaired;
later launches can use
`task extension:run:brave CHANNEL=dev` on the same profile. Production is
rejected because the task creates vault data.

Chrome and Brave do not support silently installing an unsigned extension into
a normal browser profile. The launch tasks therefore use stable, isolated Nook
profiles. Brave and Chrome for Testing receive the verified directory through
`--load-extension`. Branded Google Chrome removed that switch in Chrome 137, so
the task opens `chrome://extensions`; click **Load unpacked** once and select the
printed `current` directory. Chrome remembers that unpacked extension in the
isolated profile for later launches. With no selector the tasks build for
trusted HTTPS localhost as before:

```bash
task extension:run:chrome
task extension:run:brave
```

For fast local iteration without Docker, run the host-native loop:

```bash
task extension:dev
```

It builds dev WASM with the host Rust toolchain, serves the unified web app at
`https://localhost:5173` through Vite, starts the local S3 server described
below, builds the extension with the pinned Bun
(installed once under `~/.nook/bun/<version>`), and opens Brave on an isolated
dev profile with the extension unpacked. Rust changes rebuild WASM and the
extension; extension or shared web changes rebuild the extension. Each rebuild
reloads the extension through `chrome://extensions` (keeping Developer mode on in
that profile) and refreshes open web tabs; Vite reloads the vault page itself.
Press `r` to rebuild everything, `e` to rebuild the extension, `q` to stop.
Brave stays open, and rerunning the task reattaches to it. Pairing state persists
in the profile, so device setup and vault pairing are done once by hand. To
start over with no extension, vault, or S3 data, run `task extension:dev:fresh`: it
deletes the local S3 dev data (refusing while a server answers on port 8333),
closes Brave, deletes the dev profile, and starts the same loop.

The loop also runs a local S3-compatible server. A keyring can then sync to it,
and the extension can open its vault through it, with no Google sign-in and no
folder picker. `task extension:dev` and `task s3:dev` install the pinned
SeaweedFS release (`weed mini`) once under `~/.nook/seaweedfs/<version>`, after
checking its SHA-256. The pin covers macOS arm64 and Linux x86-64 hosts, and
Vite and the server stop together. Run only the server, or delete its data:

```bash
task s3:dev        # serve until Ctrl+C
task s3:dev:reset  # delete the data; refuses while a server answers on port 8333
```

- **Connection:** endpoint `http://127.0.0.1:8333`, region `us-east-1`, bucket
  `nook-dev`. Choose S3-compatible storage in the web vault and enter these
  with one of the keys below.
- **Keys:** `device-a`, `device-b`, and `device-c` have full access to the
  bucket. `no-access` is refused, so it shows the "no access" failure. Give
  each browser's web vault a different key, such as `device-a` in the first and
  `device-b` in a second browser. The extension reuses the key of its web
  vault.
- **TEST-ONLY secrets:** `scripts/local-s3-identities.json` holds them. They
  work only against this loopback server.
- **Data:** `~/Library/Application Support/Nook/s3-dev` on macOS, and
  `$XDG_DATA_HOME/nook/s3-dev` (default `~/.local/share/nook/s3-dev`) on Linux.
  It persists until `task s3:dev:reset`. `task extension:dev:fresh` resets it
  and clears the Brave profile.
- **CORS:** the server allows exactly `https://localhost:5173`,
  `http://127.0.0.1:5173`, `http://127.0.0.1:5174`, and the loop's own
  extension origin.
- **Playwright and CI:** the web app and extension Playwright configs start the
  same server through a `webServer` entry, on a fresh temporary data directory
  that the run deletes. The e2e image installs the same pinned `weed` binary in
  `/usr/local/bin`.

`extension:run:*` only installs and launches the browser; it does not create a
vault or approve pairing. Use `extension:setup:brave` for that bootstrap, or
`extension:smoke:hosted` for a disposable Chromium CI-style smoke.

Run `task web:dev` first for that local flow. To download and launch an exact
hosted deployment instead, select development, production, or a PR preview:

```bash
task extension:run:chrome CHANNEL=dev
task extension:run:brave CHANNEL=prod
task extension:run:chrome PR=410

# Verify and install without opening a browser:
task extension:install:hosted PR=410
```

The hosted installer follows redirects but fails on HTTP errors, validates the
selected deployment's `extension.json`, downloads its ZIP and checksum, verifies
SHA-256 before extraction, rejects unsafe archive paths, and atomically switches
the channel's stable `current` symlink only after validation succeeds. Hosted
installs live below
`~/Library/Application Support/Nook/browser-extensions/nook-web-extension/hosted/`;
profiles live below `~/Library/Application Support/Nook/browser-profiles/`.
Development, production, and every PR number use different install and profile
directories, so they cannot reuse extension state. Override the two roots with
`NOOK_EXTENSION_RELEASE_DIR` and `NOOK_EXTENSION_PROFILE_ROOT` when needed.

Device-protection WebAuthn ceremonies omit the RP ID and let Chromium bind the
credential to the stable extension origin. Website-passkey ceremonies instead
preserve the website's validated HTTPS RP ID and origin; private credential key
material never crosses the Rust/WASM boundary.
