import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createManifest } from '../../nook-web-extension/src/manifest'

const webRoot = resolve(import.meta.dir, '../..')
const simpleRoot = join(webRoot, 'nook-vault-simple')
const sentinelRoot = join(webRoot, 'nook-vault-sentinel')

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
if (existsSync(join(webRoot, 'nook-web-app/dist/site/migration.html'))) {
  throw new Error('Public site artifact contains a retired migration broker.')
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
if (!contentScript.includes('location.origin !== SENTINEL_ORIGIN')) {
  throw new Error('Extension content script lacks a Sentinel runtime guard.')
}

console.log(
  'Verified independent Simple and Sentinel artifacts and extension isolation.',
)
