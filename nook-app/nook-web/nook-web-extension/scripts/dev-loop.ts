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
const webRoot = join(webGroupRoot, 'nook-web-app')
const sharedSourceRoot = join(webGroupRoot, 'nook-web-shared', 'src')
const platformRoot = resolve(webGroupRoot, '..', 'nook-platform')
const repoRoot = resolve(platformRoot, '..', '..')
const distDir = join(extensionRoot, 'dist')

const vaultUrl = 'https://localhost:5173/'
const httpsDir =
  process.env.LOCAL_HTTPS_DIR?.trim() || join(homedir(), '.nook', 'https')
const cdpPort = Number(process.env.NOOK_DEV_CDP_PORT?.trim() || '9333')
const browserBinary =
  process.env.NOOK_DEV_BROWSER_BIN?.trim() ||
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
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

const startedAt = performance.now()
const log = (message: string): void => {
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(`\x1b[36m[dev ${elapsed}s]\x1b[0m ${message}`)
}

const runStep = async (
  label: string,
  command: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<boolean> => {
  const stepStart = performance.now()
  log(`${label}…`)
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  })
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
  runStep(
    'WASM (dev, no wasm-opt)',
    ['task', '--silent', '_wasm:build'],
    repoRoot,
    {
      WASM_BUILD_MODE: 'dev',
    },
  )

const buildExtension = (): Promise<boolean> =>
  runStep('Extension build', ['bun', 'scripts/build.ts'], extensionRoot, {
    NOOK_SIMPLE_VAULT_URL: vaultUrl,
    NOOK_EXTENSION_CHANNEL: 'local',
  })

const startVite = (): Subprocess =>
  Bun.spawn(
    [
      'bun',
      'run',
      'dev',
      '--',
      '--host',
      'localhost',
      '--port',
      '5173',
      '--strictPort',
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NOOK_LOCAL_HTTPS: '1',
        NOOK_LOCAL_HTTPS_CERT_PATH: join(httpsDir, 'localhost.pem'),
        NOOK_LOCAL_HTTPS_KEY_PATH: join(httpsDir, 'localhost-key.pem'),
      },
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

// Marks a property that parsed JSON does not carry.
const MISSING: unique symbol = Symbol('missing')

// Reads one property of parsed JSON without asserting its shape.
const field = (value: unknown, key: string): unknown =>
  value instanceof Object && Reflect.has(value, key)
    ? Reflect.get(value, key)
    : MISSING

const readBuiltManifestKey = async (): Promise<string> => {
  const key = field(
    JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8')),
    'key',
  )
  if (typeof key !== 'string') {
    throw new Error(
      'Built manifest has no key; the local channel build must set one.',
    )
  }
  return key
}

enum CdpEndpointKind {
  Listening = 'listening',
  Absent = 'absent',
}

type CdpEndpoint =
  | { readonly kind: CdpEndpointKind.Listening; readonly url: string }
  | { readonly kind: CdpEndpointKind.Absent }

// The browser-level CDP WebSocket endpoint: listening when a browser serves
// the dev port, absent when nothing answers there.
const cdpBrowserEndpoint = async (): Promise<CdpEndpoint> => {
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
  } catch {
    return { kind: CdpEndpointKind.Absent }
  }
  const url = response.ok
    ? field(await response.json(), 'webSocketDebuggerUrl')
    : MISSING
  return typeof url === 'string'
    ? { kind: CdpEndpointKind.Listening, url }
    : { kind: CdpEndpointKind.Absent }
}

const cdpListening = async (): Promise<boolean> =>
  (await cdpBrowserEndpoint()).kind === CdpEndpointKind.Listening

// Minimal flat-session CDP client over the browser endpoint.
class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<number, (reply: unknown) => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const reply: unknown = JSON.parse(String(event.data))
      const id = field(reply, 'id')
      if (typeof id === 'number') this.pending.get(id)?.(reply)
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
        const error = field(reply, 'error')
        if (error === MISSING) resolveSend(field(reply, 'result'))
        else
          rejectSend(new Error(`${method}: ${String(field(error, 'message'))}`))
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
  if (exception !== MISSING) throw new Error(JSON.stringify(exception))
  return field(field(result, 'result'), 'value')
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
  const endpoint = await cdpBrowserEndpoint()
  if (endpoint.kind === CdpEndpointKind.Absent) {
    log(
      `\x1b[31mBrowser CDP is not reachable on port ${cdpPort}; relaunch the loop.\x1b[0m`,
    )
    return
  }
  const extensionId = extensionIdFromManifestKey(await readBuiltManifestKey())
  const cdp = await CdpConnection.open(endpoint.url)
  try {
    const created = await cdp.send('Target.createTarget', {
      url: 'chrome://extensions/',
      background: true,
    })
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: field(created, 'targetId'),
      flatten: true,
    })
    const sessionId = String(field(attached, 'sessionId'))
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
      targetId: field(created, 'targetId'),
    })
    if (state !== 'enabled') {
      throw new Error(
        `extension ${extensionId} is ${String(state)} after reload; see chrome://extensions`,
      )
    }
    const targets = await cdp.send('Target.getTargets', {})
    const targetInfos: unknown = field(targets, 'targetInfos')
    const webPages = (Array.isArray(targetInfos) ? targetInfos : []).filter(
      (target: unknown) =>
        field(target, 'type') === 'page' &&
        /^https?:/.test(String(field(target, 'url'))),
    )
    for (const page of webPages) {
      const pageSession = await cdp.send('Target.attachToTarget', {
        targetId: field(page, 'targetId'),
        flatten: true,
      })
      await cdp.send('Page.reload', {}, String(field(pageSession, 'sessionId')))
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
    if (!(await cdpListening())) return
  }
  throw new Error(`Browser on CDP port ${cdpPort} did not close.`)
}

const resetProfile = async (): Promise<void> => {
  const endpoint = await cdpBrowserEndpoint()
  if (endpoint.kind === CdpEndpointKind.Listening) {
    await closeBrowser(endpoint.url)
  }
  // Chromium releases the profile lock just after its CDP endpoint goes away.
  await sleep(500)
  await rm(profileDir, { recursive: true, force: true })
  log(`Deleted dev profile ${profileDir}`)
}

const launchBrowser = async (): Promise<void> => {
  if (freshProfile) await resetProfile()
  if (await cdpListening()) {
    log(`Reusing browser already listening on CDP port ${cdpPort}`)
    await reloadExtension()
    return
  }
  await mkdir(profileDir, { recursive: true })
  const browser = Bun.spawn(
    [
      browserBinary,
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
    if (await cdpListening()) {
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
// Each schedule call starts a newer generation; only the latest one drains.
let generation = 0

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
  generation += 1
  const scheduled = generation
  setTimeout(() => {
    if (scheduled === generation) void drain()
  }, 250)
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
