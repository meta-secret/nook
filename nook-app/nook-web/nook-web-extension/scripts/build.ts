import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import packageJson from '../package.json'
import { createManifest } from '../src/manifest'
import {
  DEFAULT_SIMPLE_VAULT_URL,
  normalizeSimpleVaultBaseUrl,
} from '../src/lib/simple-vault-target'
import { extensionChannelIdentity } from './channel-identity'

const projectRoot = resolve(import.meta.dir, '..')
const webGroupRoot = resolve(projectRoot, '..')
const webRoot = join(webGroupRoot, 'nook-web-app')
const sharedRoot = join(webGroupRoot, 'nook-web-shared')
const coreLocalesRoot = join(webGroupRoot, '..', 'nook-core', 'locales')
const distDir = join(projectRoot, 'dist')
const requireFromWeb = createRequire(join(webRoot, 'package.json'))
const simpleVaultBaseUrl = normalizeSimpleVaultBaseUrl(
  process.env.NOOK_SIMPLE_VAULT_URL?.trim() || DEFAULT_SIMPLE_VAULT_URL,
)
const simpleVaultDefine = {
  __NOOK_SIMPLE_VAULT_URL__: JSON.stringify(simpleVaultBaseUrl),
}
const deployment = extensionChannelIdentity(
  process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production',
)
const requestedVersion =
  process.env.NOOK_EXTENSION_VERSION?.trim() || packageJson.version
const manifestVersion = requestedVersion.match(/^\d+\.\d+\.\d+/)?.[0]
if (!manifestVersion) {
  throw new Error('NOOK_EXTENSION_VERSION must begin with a semantic version.')
}
const commit = process.env.NOOK_EXTENSION_COMMIT?.trim()
const versionName = commit
  ? `${requestedVersion} (${deployment.channel}, ${commit.slice(0, 12)})`
  : `${requestedVersion} (${deployment.channel})`

async function ensureNodeModulesLink() {
  try {
    await symlink(
      '../nook-web-app/node_modules',
      join(projectRoot, 'node_modules'),
      'dir',
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return
    }
    throw error
  }
}

async function buildEntrypoint(entrypoint: string, outdir: string) {
  const result = await Bun.build({
    entrypoints: [join(projectRoot, entrypoint)],
    outdir: join(distDir, outdir),
    target: 'browser',
    format: 'esm',
    sourcemap: 'external',
    minify: false,
    splitting: false,
    naming: '[name].js',
    define: simpleVaultDefine,
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`Failed to build ${entrypoint}`)
  }
}

async function copyStaticFile(source: string, destination: string) {
  const outputPath = join(distDir, destination)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(source, outputPath)
}

async function importWebDependency<TModule>(specifier: string) {
  const resolved = requireFromWeb.resolve(specifier)
  return import(pathToFileURL(resolved).href) as Promise<TModule>
}

async function buildSveltePage(page: 'popup') {
  const { build: viteBuild } =
    await importWebDependency<typeof import('vite')>('vite')
  const { svelte } = await importWebDependency<
    typeof import('@sveltejs/vite-plugin-svelte')
  >('@sveltejs/vite-plugin-svelte')

  await viteBuild({
    root: join(projectRoot, `src/${page}`),
    configFile: false,
    base: './',
    publicDir: false,
    plugins: [svelte()],
    define: simpleVaultDefine,
    build: {
      outDir: join(distDir, page),
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: join(projectRoot, `src/${page}/index.html`),
      },
    },
    resolve: {
      alias: {
        '@nook/shared': join(sharedRoot, 'src'),
      },
      dedupe: ['svelte'],
    },
  })
}

type NookLocaleCatalog = {
  extension: {
    widget: {
      open_vault: string
      dismiss: string
      collapse: string
      expand: string
      gate_step: string
      gate_title: string
      gate_description: string
      continue: string
      working: string
      unlock_then_continue: string
      no_match: string
      choose_account: string
      fill_failed: string
    }
    passkey: {
      save_title: string
      use_title: string
      use_browser: string
    }
  }
}

async function buildChromeLocales() {
  await Promise.all(
    ['en', 'ru'].map(async (locale) => {
      const catalog = JSON.parse(
        await readFile(join(coreLocalesRoot, `${locale}.json`), 'utf8'),
      ) as NookLocaleCatalog
      const messages = {
        widgetOpenVault: { message: catalog.extension.widget.open_vault },
        widgetDismiss: { message: catalog.extension.widget.dismiss },
        widgetCollapse: { message: catalog.extension.widget.collapse },
        widgetExpand: { message: catalog.extension.widget.expand },
        widgetGateStep: { message: catalog.extension.widget.gate_step },
        widgetGateTitle: { message: catalog.extension.widget.gate_title },
        widgetGateDescription: {
          message: catalog.extension.widget.gate_description,
        },
        widgetContinue: { message: catalog.extension.widget.continue },
        widgetWorking: { message: catalog.extension.widget.working },
        widgetUnlockThenContinue: {
          message: catalog.extension.widget.unlock_then_continue,
        },
        widgetNoMatch: { message: catalog.extension.widget.no_match },
        widgetChooseAccount: {
          message: catalog.extension.widget.choose_account,
        },
        widgetFillFailed: { message: catalog.extension.widget.fill_failed },
        passkeySaveTitle: { message: catalog.extension.passkey.save_title },
        passkeyUseTitle: { message: catalog.extension.passkey.use_title },
        passkeyUseBrowser: { message: catalog.extension.passkey.use_browser },
      }
      const localeDir = join(distDir, '_locales', locale)
      await mkdir(localeDir, { recursive: true })
      await writeFile(
        join(localeDir, 'messages.json'),
        `${JSON.stringify(messages, undefined, 2)}\n`,
      )
    }),
  )
}

await ensureNodeModulesLink()
await rm(distDir, { force: true, recursive: true })
await mkdir(distDir, { recursive: true })

await Promise.all([
  buildEntrypoint('src/background/service-worker.ts', 'background'),
  buildEntrypoint('src/content/autofill.ts', 'content'),
  buildEntrypoint('src/content/webauthn-content.ts', 'content'),
  buildEntrypoint('src/content/webauthn-page.ts', 'content'),
  buildEntrypoint('src/content/simple-vault-bridge.ts', 'content'),
  buildEntrypoint('src/offscreen/session.ts', 'offscreen'),
])

await Promise.all([buildSveltePage('popup'), buildChromeLocales()])

await writeFile(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(
    createManifest(manifestVersion, simpleVaultBaseUrl, {
      key: deployment.manifestKey,
      name: deployment.name,
      shortName: deployment.shortName,
      versionName,
    }),
    null,
    2,
  )}\n`,
)

await Promise.all([
  copyStaticFile(join(webRoot, 'public/favicon.png'), 'icons/nook.png'),
  copyStaticFile(
    join(projectRoot, 'src/offscreen/session.html'),
    'offscreen/session.html',
  ),
  copyStaticFile(
    join(sharedRoot, 'src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm'),
    'background/nook_wasm_bg.wasm',
  ),
  copyStaticFile(
    join(sharedRoot, 'src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm'),
    'offscreen/nook_wasm_bg.wasm',
  ),
])

console.log(`Built Nook extension at ${distDir}`)
