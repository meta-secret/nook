import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createManifest } from '../../nook-web-extension/src/manifest'

const webRoot = resolve(import.meta.dir, '../..')
const simpleRoot = join(webRoot, 'nook-vault-simple')
const sentinelRoot = join(webRoot, 'nook-vault-sentinel')
const siteRoot = join(webRoot, 'nook-web-app/dist/site')

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesBelow(path) : [path]
    }),
  )
  return files.flat()
}

for (const root of [simpleRoot, sentinelRoot]) {
  if (
    !existsSync(join(root, 'package.json')) ||
    !existsSync(join(root, 'dist/index.html'))
  ) {
    throw new Error(`Independent vault project was not built: ${root}`)
  }
  if (existsSync(join(root, 'dist/migrate.html'))) {
    throw new Error(
      `Vault artifact contains a retired migration route: ${root}`,
    )
  }
}
if (existsSync(join(siteRoot, 'migration.html'))) {
  throw new Error('Public site artifact contains a retired migration broker.')
}
const siteNotFoundHtml = await readFile(join(siteRoot, '404.html'), 'utf8')
if (
  !siteNotFoundHtml.includes('<h1>404</h1>') ||
  siteNotFoundHtml.includes('Nook — Keys, not accounts')
) {
  throw new Error(
    'Public site artifact must provide a dedicated static not-found page.',
  )
}

const expectedLegacyRoutes = [
  '/site',
  '/site/*',
  '/simple',
  '/simple/*',
  '/sentinel',
  '/sentinel/*',
  '/app',
  '/app/*',
  '/app-logs',
  '/app-logs/*',
  '/app-logs.html',
  '/logs',
  '/logs/*',
  '/logs.html',
  '/extension-connect',
  '/extension-connect/*',
  '/extension-connect.html',
]
const pagesRoutes = JSON.parse(
  await readFile(join(siteRoot, '_routes.json'), 'utf8'),
) as { version?: number; include?: string[]; exclude?: string[] }
if (
  pagesRoutes.version !== 1 ||
  JSON.stringify(pagesRoutes.include) !==
    JSON.stringify(expectedLegacyRoutes) ||
  JSON.stringify(pagesRoutes.exclude) !== '[]'
) {
  throw new Error(
    'Public site artifact must invoke its Pages Function only for retired app routes.',
  )
}

type PagesWorker = {
  fetch(
    request: Request,
    env: { ASSETS: { fetch(request: Request): Promise<Response> } },
  ): Promise<Response>
}
const workerUrl = `${pathToFileURL(join(siteRoot, '_worker.js')).href}?verify=${Date.now()}`
const pagesWorker = (await import(workerUrl)).default as PagesWorker
let staticAssetRequests = 0
const workerEnv = {
  ASSETS: {
    async fetch(): Promise<Response> {
      staticAssetRequests += 1
      return new Response('asset')
    },
  },
}
for (const path of [
  '/site',
  '/site/deep/link',
  '/simple/',
  '/sentinel/deep/link',
  '/app/',
  '/app/deep/link',
  '/app-logs',
  '/app-logs.html',
  '/logs/deep/link',
  '/logs.html',
  '/extension-connect',
  '/extension-connect.html',
]) {
  const response = await pagesWorker.fetch(
    new Request(`https://dev.nokey.sh${path}`),
    workerEnv,
  )
  if (
    response.status !== 404 ||
    response.headers.get('Cache-Control') !== 'no-store'
  ) {
    throw new Error(`Pages Function must return an uncached 404 for ${path}.`)
  }
}
if (staticAssetRequests !== 0) {
  throw new Error('Retired app routes must not reach Pages static assets.')
}
for (const path of ['/', '/sitemap.xml']) {
  const response = await pagesWorker.fetch(
    new Request(`https://dev.nokey.sh${path}`),
    workerEnv,
  )
  if (response.status !== 200) {
    throw new Error(`Pages Function must delegate ${path} to static assets.`)
  }
}
if (staticAssetRequests !== 2) {
  throw new Error('Public landing routes must remain static asset requests.')
}

const simpleHtml = await readFile(join(simpleRoot, 'dist/index.html'), 'utf8')
const sentinelHtml = await readFile(
  join(sentinelRoot, 'dist/index.html'),
  'utf8',
)
if (!simpleHtml.includes('name="nook-app-kind" content="simple"')) {
  throw new Error('Simple Vault artifact is missing its fixed app identity.')
}
if (!sentinelHtml.includes('name="nook-app-kind" content="sentinel"')) {
  throw new Error('Sentinel Vault artifact is missing its fixed app identity.')
}
if (!existsSync(join(simpleRoot, 'dist/extension-connect.html'))) {
  throw new Error(
    'Simple Vault artifact is missing its extension consent route.',
  )
}
if (existsSync(join(sentinelRoot, 'dist/extension-connect.html'))) {
  throw new Error(
    'Sentinel Vault artifact contains an extension consent route.',
  )
}
for (const appKind of ['simple', 'sentinel'] as const) {
  const previewHtml = await readFile(
    join(webRoot, `nook-web-app/dist/${appKind}/index.html`),
    'utf8',
  )
  if (!previewHtml.includes(`name="nook-app-kind" content="${appKind}"`)) {
    throw new Error(
      `PR preview is missing the independent ${appKind} artifact.`,
    )
  }
}
for (const root of [simpleRoot, sentinelRoot]) {
  const headers = await readFile(join(root, 'dist/_headers'), 'utf8')
  for (const required of [
    'Content-Security-Policy:',
    "frame-ancestors 'none'",
    'X-Content-Type-Options: nosniff',
  ]) {
    if (!headers.includes(required)) {
      throw new Error(
        `${root} is missing required security header: ${required}`,
      )
    }
  }
}

const sharedBindings = await readFile(
  join(webRoot, 'nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'),
  'utf8',
)
for (const requiredExport of [
  'configureVaultApplication',
  'configuredVaultApplication',
  'approveExtensionDevice',
]) {
  if (!sharedBindings.includes(requiredExport)) {
    throw new Error(`Shared WASM is missing ${requiredExport}.`)
  }
}
for (const retiredExport of [
  'beginVaultMigration',
  'buildVaultMigrationCapsule',
  'acceptVaultMigrationCapsule',
  'finishVaultMigrationWithPasskey',
  'validateVaultMigrationRequestOrigin',
]) {
  if (sharedBindings.includes(retiredExport)) {
    throw new Error(`Shared WASM still exports ${retiredExport}.`)
  }
}

const sentinelText = (
  await Promise.all(
    (await filesBelow(join(sentinelRoot, 'dist')))
      .filter((path) => path.endsWith('.js') || path.endsWith('.html'))
      .map((path) => readFile(path, 'utf8')),
  )
).join('\n')
for (const forbidden of [
  'nook:extension-pairing-approved',
  'sync-provider-credentials',
]) {
  if (sentinelText.includes(forbidden)) {
    throw new Error(
      `Sentinel Vault bundle contains extension protocol token: ${forbidden}`,
    )
  }
}

const manifest = createManifest('1.0.0')
if (
  manifest.externally_connectable.matches.length !== 1 ||
  manifest.externally_connectable.matches[0] !== 'https://simple.nokey.sh/*'
) {
  throw new Error('Extension external connections are not Simple-only.')
}
if (
  !manifest.content_scripts.every((script) =>
    script.exclude_matches.includes('https://sentinel.nokey.sh/*'),
  )
) {
  throw new Error('Extension content scripts do not exclude Sentinel Vault.')
}
const contentScript = await readFile(
  join(webRoot, 'nook-web-extension/src/content/autofill.ts'),
  'utf8',
)
if (!contentScript.includes('isRuntimeSentinelVaultUrl(location.href)')) {
  throw new Error('Extension content script lacks a Sentinel runtime guard.')
}

const previewManifest = createManifest(
  '1.0.0',
  'https://pr-391.nook-1n8.pages.dev/simple/',
)
if (
  previewManifest.action.default_popup !== 'popup/index.html' ||
  previewManifest.externally_connectable.matches[0] !==
    'https://pr-391.nook-1n8.pages.dev/simple/*' ||
  !previewManifest.content_scripts[0]?.exclude_matches.includes(
    'https://pr-391.nook-1n8.pages.dev/sentinel/*',
  )
) {
  throw new Error('Extension preview target is not path-isolated by app.')
}

console.log(
  'Verified independent Simple and Sentinel artifacts and extension isolation.',
)
