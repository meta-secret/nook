// Host-native local loop for the extension and the localhost vault it pairs with.
// Builds dev WASM, serves the unified web app at https://localhost:5173 through Vite,
// builds the extension for that origin, opens Brave with it unpacked, then rebuilds and
// reloads the extension whenever Rust or web sources change. Vite owns web-app reloads.
import { watch } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { Subprocess } from 'bun'

const extensionRoot = resolve(import.meta.dir, '..')
const webGroupRoot = resolve(extensionRoot, '..')
const sharedSourceRoot = join(webGroupRoot, 'nook-web-shared', 'src')
const platformRoot = resolve(webGroupRoot, '..', 'nook-platform')
const repoRoot = resolve(platformRoot, '..', '..')
const distDir = join(extensionRoot, 'dist')

const vaultUrl = 'https://localhost:5173/'
const cdpPort = Number(process.env.NOOK_DEV_CDP_PORT?.trim() || '9333')
const profileDir =
  process.env.NOOK_DEV_PROFILE_DIR?.trim() ||
  join(
    homedir(),
    'Library',
    'Application Support',
    'Nook',
    'browser-profiles',
    'brave-extension-dev',
  )

// Crates compiled into nook-wasm or nook-companion-wasm (mirrors the _wasm:build stamp).
const wasmCrates = [
  'nook-wasm',
  'nook-companion-wasm',
  'nook-companion-core',
  'nook-page-policy',
  'nook-app-common',
  'nook-core',
  'nook-authenticator-domain',
  'nook-auth2',
  'nook-replication',
  'nook-event-log',
]
// WASM build outputs live inside the shared source tree; the WASM step owns them.
const wasmOutputDirs = [
  join('vault-app', 'lib', 'nook-wasm'),
  join('extension', 'nook-companion-wasm'),
]

// The WASM and extension builds and Vite inherit their settings (a dev WASM
// build, the local channel against the HTTPS dev vault) from extension:dev.

const startedAt = performance.now()
const log = (message: string): void => {
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(`\x1b[36m[dev ${elapsed}s]\x1b[0m ${message}`)
}

// Runs one build step; each step spawns its own fixed command. The loop runs
// from the extension root (its Taskfile changes there first), so commands name
// fixed paths relative to it.
const runStep = async (
  label: string,
  launch: () => Subprocess,
): Promise<boolean> => {
  const stepStart = performance.now()
  log(`${label}…`)
  const child = launch()
  const exitCode = await child.exited
  const seconds = ((performance.now() - stepStart) / 1000).toFixed(1)
  log(
    exitCode === 0
      ? `${label} done in ${seconds}s`
      : `\x1b[31m${label} FAILED (exit ${exitCode}) after ${seconds}s\x1b[0m`,
  )
  return exitCode === 0
}

const buildWasm = (): Promise<boolean> =>
  runStep('WASM (dev, no wasm-opt)', () =>
    Bun.spawn(['task', '--dir', repoRoot, '--silent', '_wasm:build'], {
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  )

const buildExtension = (): Promise<boolean> =>
  runStep('Extension build', () =>
    Bun.spawn(['bun', 'scripts/build.ts'], {
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  )

const startVite = (): Subprocess =>
  Bun.spawn(
    [
      'bun',
      '../nook-web-app/node_modules/.bin/vite',
      '../nook-web-app',
      '--host',
      'localhost',
      '--port',
      '5173',
      '--strictPort',
    ],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )

// Chromium derives an unpacked extension's ID from the manifest key.
const extensionIdFromManifestKey = (manifestKey: string): string => {
  const digest = new Bun.CryptoHasher('sha256')
    .update(Buffer.from(manifestKey, 'base64'))
    .digest('hex')
  return [...digest.slice(0, 32)]
    .map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)))
    .join('')
}

enum JsonFieldKind {
  Missing = 'missing',
  Present = 'present',
}
type JsonField =
  | { kind: JsonFieldKind.Missing }
  | { kind: JsonFieldKind.Present; value: unknown }

// Parsed JSON cannot contain an absent-value literal: observe field presence.
const field = (value: unknown, key: string): JsonField =>
  value instanceof Object && Object.hasOwn(value, key)
    ? { kind: JsonFieldKind.Present, value: Reflect.get(value, key) }
    : { kind: JsonFieldKind.Missing }

const requiredField = (value: unknown, key: string): unknown => {
  const found = field(value, key)
  if (found.kind === JsonFieldKind.Missing)
    throw new Error(`CDP response has no ${key} field`)
  return found.value
}

const readBuiltManifestKey = async (): Promise<string> => {
  const key = field(
    JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8')),
    'key',
  )
  if (key.kind === JsonFieldKind.Missing || typeof key.value !== 'string') {
    throw new Error(
      'Built manifest has no key; the local channel build must set one.',
    )
  }
  return key.value
}

enum CdpBrowserKind {
  Unavailable = 'unavailable',
  Available = 'available',
}
type CdpBrowser =
  | { kind: CdpBrowserKind.Unavailable }
  | { kind: CdpBrowserKind.Available; url: string }

// The browser-level CDP WebSocket URL, when a browser listens on the dev port.
const cdpBrowserUrl = async (): Promise<CdpBrowser> => {
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
  } catch {
    return { kind: CdpBrowserKind.Unavailable }
  }
  if (!response.ok) return { kind: CdpBrowserKind.Unavailable }
  const url = field(await response.json(), 'webSocketDebuggerUrl')
  return url.kind === JsonFieldKind.Present &&
    typeof url.value === 'string' &&
    url.value
    ? { kind: CdpBrowserKind.Available, url: url.value }
    : { kind: CdpBrowserKind.Unavailable }
}

// Minimal flat-session CDP client over the browser endpoint.
class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<number, (reply: unknown) => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const reply: unknown = JSON.parse(String(event.data))
      const id = field(reply, 'id')
      if (id.kind === JsonFieldKind.Present && typeof id.value === 'number')
        this.pending.get(id.value)?.(reply)
    })
  }

  static open(url: string): Promise<CdpConnection> {
    const socket = new WebSocket(url)
    return new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', () =>
        resolveOpen(new CdpConnection(socket)),
      )
      socket.addEventListener('error', () =>
        rejectOpen(new Error(`CDP connection to ${url} failed`)),
      )
    })
  }

  send(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    const id = this.nextId++
    this.socket.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, (reply) => {
        this.pending.delete(id)
        try {
          const error = field(reply, 'error')
          if (error.kind === JsonFieldKind.Missing)
            resolveSend(requiredField(reply, 'result'))
          else
            rejectSend(
              new Error(
                `${method}: ${String(requiredField(error.value, 'message'))}`,
              ),
            )
        } catch (error) {
          rejectSend(error)
        }
      })
    })
  }

  close(): void {
    this.socket.close()
  }
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))

const evaluateIn = async (
  cdp: CdpConnection,
  sessionId: string,
  expression: string,
): Promise<unknown> => {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true },
    sessionId,
  )
  const exception = field(result, 'exceptionDetails')
  if (exception.kind === JsonFieldKind.Present)
    throw new Error(JSON.stringify(exception.value))
  return requiredField(requiredField(result, 'result'), 'value')
}

// Runs on chrome://extensions. Chromium disables a --load-extension extension on reload
// unless Developer mode is on, so the dev profile keeps it on before reloading.
const developerReloadScript = (extensionId: string): string => `
  new Promise((resolveReload, rejectReload) => {
    const check = (next) => () =>
      chrome.runtime.lastError ? rejectReload(new Error(chrome.runtime.lastError.message)) : next()
    chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, check(() =>
      chrome.management.setEnabled(${JSON.stringify(extensionId)}, true, check(() =>
        chrome.developerPrivate.reload(${JSON.stringify(extensionId)}, { failQuietly: false }, check(() =>
          setTimeout(() => chrome.management.get(${JSON.stringify(extensionId)}, (info) =>
            resolveReload(info.enabled ? 'enabled' : 'disabled')), 500)))))))
  })`

// Reload the unpacked extension through the extensions page, then reload web tabs so
// content scripts and the vault bridge reattach to the new extension instance.
const reloadExtension = async (): Promise<void> => {
  const browserUrl = await cdpBrowserUrl()
  if (browserUrl.kind === CdpBrowserKind.Unavailable) {
    log(
      `\x1b[31mBrowser CDP is not reachable on port ${cdpPort}; relaunch the loop.\x1b[0m`,
    )
    return
  }
  const extensionId = extensionIdFromManifestKey(await readBuiltManifestKey())
  const cdp = await CdpConnection.open(browserUrl.url)
  try {
    const created = await cdp.send('Target.createTarget', {
      url: 'chrome://extensions/',
      background: true,
    })
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: requiredField(created, 'targetId'),
      flatten: true,
    })
    const sessionId = String(requiredField(attached, 'sessionId'))
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await evaluateIn(
        cdp,
        sessionId,
        "typeof chrome?.developerPrivate?.reload === 'function'",
      )
      if (ready === true) break
      await sleep(100)
    }
    const state = await evaluateIn(
      cdp,
      sessionId,
      developerReloadScript(extensionId),
    )
    await cdp.send('Target.closeTarget', {
      targetId: requiredField(created, 'targetId'),
    })
    if (state !== 'enabled') {
      throw new Error(
        `extension ${extensionId} is ${String(state)} after reload; see chrome://extensions`,
      )
    }
    const targets = await cdp.send('Target.getTargets', {})
    const targetInfos = field(targets, 'targetInfos')
    const webPages = (
      targetInfos.kind === JsonFieldKind.Present &&
      Array.isArray(targetInfos.value)
        ? targetInfos.value
        : []
    ).filter((target: unknown) => {
      const type = field(target, 'type')
      const url = field(target, 'url')
      return (
        type.kind === JsonFieldKind.Present &&
        type.value === 'page' &&
        url.kind === JsonFieldKind.Present &&
        /^https?:/.test(String(url.value))
      )
    })
    for (const page of webPages) {
      const pageSession = await cdp.send('Target.attachToTarget', {
        targetId: requiredField(page, 'targetId'),
        flatten: true,
      })
      await cdp.send(
        'Page.reload',
        {},
        String(requiredField(pageSession, 'sessionId')),
      )
    }
    log(
      `Extension ${extensionId} reloaded; ${webPages.length} web tab(s) refreshed`,
    )
  } finally {
    cdp.close()
  }
}

// Fresh mode starts from an empty dev profile: no extension pairing, device key or
// localhost vault data. It closes a browser still using that profile first.
const freshProfile = process.env.NOOK_DEV_FRESH_PROFILE === '1'

const closeBrowser = async (browserUrl: string): Promise<void> => {
  const cdp = await CdpConnection.open(browserUrl)
  // The browser drops the connection as it closes, so the reply never arrives.
  void cdp.send('Browser.close', {})
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await sleep(100)
    if ((await cdpBrowserUrl()).kind === CdpBrowserKind.Unavailable) return
  }
  throw new Error(`Browser on CDP port ${cdpPort} did not close.`)
}

const resetProfile = async (): Promise<void> => {
  const browserUrl = await cdpBrowserUrl()
  if (browserUrl.kind === CdpBrowserKind.Available)
    await closeBrowser(browserUrl.url)
  // Chromium releases the profile lock just after its CDP endpoint goes away.
  await sleep(500)
  await rm(profileDir, { recursive: true, force: true })
  log(`Deleted dev profile ${profileDir}`)
}

const launchBrowser = async (): Promise<void> => {
  if (freshProfile) await resetProfile()
  if ((await cdpBrowserUrl()).kind === CdpBrowserKind.Available) {
    log(`Reusing browser already listening on CDP port ${cdpPort}`)
    await reloadExtension()
    return
  }
  await mkdir(profileDir, { recursive: true })
  const browser = Bun.spawn(
    [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      `--user-data-dir=${profileDir}`,
      `--load-extension=${distDir}`,
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${cdpPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      vaultUrl,
    ],
    { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' },
  )
  browser.unref()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await cdpBrowserUrl()).kind === CdpBrowserKind.Available) {
      log(`Browser up (profile ${profileDir})`)
      return
    }
    await sleep(100)
  }
  throw new Error(
    `Browser did not expose CDP on port ${cdpPort}. Close any window already using ${profileDir} and retry.`,
  )
}

type PendingWork = { rust: boolean; extension: boolean }
const pending: PendingWork = { rust: false, extension: false }
let building = false
enum DebounceKind {
  Idle = 'idle',
  Scheduled = 'scheduled',
}
type Debounce =
  | { kind: DebounceKind.Idle }
  | { kind: DebounceKind.Scheduled; timer: ReturnType<typeof setTimeout> }
let debounce: Debounce = { kind: DebounceKind.Idle }

const drain = async (): Promise<void> => {
  if (building) return
  building = true
  while (pending.rust || pending.extension) {
    const rust = pending.rust
    pending.rust = false
    pending.extension = false
    const wasmOk = rust ? await buildWasm() : true
    if (wasmOk && (await buildExtension())) {
      await reloadExtension().catch((error: unknown) =>
        log(`\x1b[31mExtension reload failed: ${String(error)}\x1b[0m`),
      )
    }
  }
  building = false
  log(
    'Watching for changes — keys: [r] rebuild all, [e] rebuild extension, [q] quit',
  )
}

const schedule = (work: Partial<PendingWork>): void => {
  pending.rust ||= work.rust === true
  pending.extension ||= work.extension === true
  if (debounce.kind === DebounceKind.Scheduled) clearTimeout(debounce.timer)
  debounce = {
    kind: DebounceKind.Scheduled,
    timer: setTimeout(() => void drain(), 250),
  }
}

const watchSources = (): void => {
  watch(platformRoot, { recursive: true }, (_event, fileName) => {
    if (!fileName) return
    const [crate = ''] = fileName.split(sep)
    const isWasmInput =
      fileName === 'Cargo.toml' ||
      fileName === 'Cargo.lock' ||
      (wasmCrates.includes(crate) && !fileName.includes(`${sep}target${sep}`))
    if (isWasmInput) {
      log(`Rust change: ${fileName}`)
      schedule({ rust: true })
    }
  })
  const extensionWatch = (root: string) =>
    watch(root, { recursive: true }, (_event, fileName) => {
      if (!fileName) return
      const changed = relative(sharedSourceRoot, join(root, fileName))
      if (wasmOutputDirs.some((dir) => changed.startsWith(dir))) return
      log(`Web change: ${relative(webGroupRoot, join(root, fileName))}`)
      schedule({ extension: true })
    })
  extensionWatch(join(extensionRoot, 'src'))
  extensionWatch(sharedSourceRoot)
}

const vite = startVite()
const shutdown = (): never => {
  vite.kill()
  log(
    'Stopped. The browser stays open; rerun `task extension:dev` to reattach.',
  )
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (!((await buildWasm()) && (await buildExtension()))) {
  vite.kill()
  process.exit(1)
}
await launchBrowser()
watchSources()
log(
  'Watching for changes — keys: [r] rebuild all, [e] rebuild extension, [q] quit',
)

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.on('data', (data: Buffer) => {
    const key = data.toString()
    if (key === 'q' || key === '\u0003') shutdown()
    if (key === 'r') schedule({ rust: true })
    if (key === 'e') schedule({ extension: true })
  })
}
