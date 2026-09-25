import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json'
import { buildChromeLocales } from './chrome-locales'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { SimpleVaultTarget } from '../src/lib/simple-vault-target'
import { normalize_simple_vault_base_url } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  createManifest,
  type CreateExtensionManifestArgs,
  ExtensionManifestBuildKind,
} from '../src/manifest'
import { extensionChannelIdentity } from './channel-identity'
import {
  ExtensionDiagnosticBuildAvailability,
  ExtensionDiagnosticBuildPolicy,
  extensionEntrypointBuildPolicy,
} from './build-contract'

await companionWasmReady

const projectRoot = resolve(import.meta.dir, '..')
const webGroupRoot = resolve(projectRoot, '..')
const webRoot = join(webGroupRoot, 'nook-web-app')
const sharedRoot = join(webGroupRoot, 'nook-web-shared')
const appCommonLocalesRoot = join(
  webGroupRoot,
  '..',
  'nook-platform',
  'nook-app-common',
  'locales',
)
const distDir = join(projectRoot, 'dist')
const simpleVaultBaseUrl = normalize_simple_vault_base_url(
  process.env.NOOK_SIMPLE_VAULT_URL?.trim() || SimpleVaultTarget.defaultBase(),
)
const simpleVaultDefine = {
  __NOOK_SIMPLE_VAULT_URL__: JSON.stringify(simpleVaultBaseUrl),
}
const deployment = extensionChannelIdentity(
  process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production',
)
const extensionDiagnosticBuildPolicy = new ExtensionDiagnosticBuildPolicy()
const extensionDiagnosticsEnabled =
  extensionDiagnosticBuildPolicy.availability({
    channel: deployment.channel,
  }) === ExtensionDiagnosticBuildAvailability.Enabled
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

const identityJsonReplacer = (_key: string, value: unknown): unknown => value

type ResolvedViteModule = {
  readonly build: typeof import('vite').build
}

type ResolvedSvelteModule = {
  readonly svelte: typeof import('@sveltejs/vite-plugin-svelte').svelte
  readonly vitePreprocess: typeof import('@sveltejs/vite-plugin-svelte').vitePreprocess
}

enum ExtensionBuildDependencySpecifier {
  Vite = 'vite',
  Svelte = '@sveltejs/vite-plugin-svelte',
}

class ExtensionBuildDependencyLoader {
  async importVite(): Promise<Pick<typeof import('vite'), 'build'>> {
    return this.importResolved(ExtensionBuildDependencySpecifier.Vite)
  }

  async importSvelte(): Promise<
    Pick<
      typeof import('@sveltejs/vite-plugin-svelte'),
      'svelte' | 'vitePreprocess'
    >
  > {
    return this.importResolved(ExtensionBuildDependencySpecifier.Svelte)
  }

  private importResolved(
    specifier: ExtensionBuildDependencySpecifier.Vite,
  ): Promise<ResolvedViteModule>
  private importResolved(
    specifier: ExtensionBuildDependencySpecifier.Svelte,
  ): Promise<ResolvedSvelteModule>
  private importResolved(
    specifier: ExtensionBuildDependencySpecifier,
  ): Promise<ResolvedViteModule | ResolvedSvelteModule> {
    switch (specifier) {
      case ExtensionBuildDependencySpecifier.Vite:
        return import('vite')
      case ExtensionBuildDependencySpecifier.Svelte:
        return import('@sveltejs/vite-plugin-svelte')
    }
  }
}

const extensionBuildDependencyLoader = new ExtensionBuildDependencyLoader()

async function ensureNodeModulesLink() {
  try {
    await symlink(
      '../nook-web-app/node_modules',
      join(projectRoot, 'node_modules'),
      'dir',
    )
  } catch (error) {
    if (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return
    }
    throw error
  }
}

async function companionWasmBytesDefine(entrypoint: string): Promise<{
  __NOOK_COMPANION_WASM_BYTES__: string
}> {
  // Content autofill must not fetch chrome-extension WASM (or use import.meta);
  // embed the package bytes so classic content scripts can initialize Pilot.
  if (!entrypoint.includes('/content/autofill.ts')) {
    return { __NOOK_COMPANION_WASM_BYTES__: JSON.stringify('') }
  }
  const wasmPath = join(
    sharedRoot,
    'src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
  )
  const wasmBase64 = Buffer.from(await readFile(wasmPath)).toString('base64')
  return { __NOOK_COMPANION_WASM_BYTES__: JSON.stringify(wasmBase64) }
}

function stripClassicContentScriptForbiddenSyntax(source: string): string {
  // wasm-bindgen keeps a default path that references import.meta.url. Classic
  // content scripts reject that at parse time even when callers always pass bytes.
  return source.replace(
    /module_or_path = new URL\(["']nook_companion_wasm_bg\.wasm["'],\s*import\.meta\.url\);/g,
    'throw new Error("Companion WASM module_or_path must be provided.");',
  )
}

async function buildEntrypoint(entrypoint: string, outdir: string) {
  const result = await Bun.build({
    entrypoints: [join(projectRoot, entrypoint)],
    outdir: join(distDir, outdir),
    target: 'browser',
    format: extensionEntrypointBuildPolicy.format({ entrypoint }),
    sourcemap: 'external',
    minify: false,
    splitting: false,
    naming: '[name].js',
    define: {
      ...simpleVaultDefine,
      __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__: JSON.stringify(
        extensionDiagnosticsEnabled,
      ),
      ...(await companionWasmBytesDefine(entrypoint)),
    },
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`Failed to build ${entrypoint}`)
  }

  if (!entrypoint.includes('/content/')) {
    return
  }
  const entryName = entrypoint.split('/').pop()?.replace(/\.ts$/, '.js')
  if (!entryName) {
    return
  }
  const outputPath = join(distDir, outdir, entryName)
  const bundled = await readFile(outputPath, 'utf8')
  const classicSafe = stripClassicContentScriptForbiddenSyntax(bundled)
  if (
    classicSafe.includes('import.meta') ||
    /^\s*import\s/m.test(classicSafe) ||
    /^\s*export\s/m.test(classicSafe)
  ) {
    throw new Error(
      `Content bundle ${entryName} still contains classic-script-forbidden ESM syntax.`,
    )
  }
  if (classicSafe !== bundled) {
    await writeFile(outputPath, classicSafe)
  }
}

async function copyStaticFile(source: string, destination: string) {
  const outputPath = join(distDir, destination)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(source, outputPath)
}

async function buildSveltePage(page: 'popup') {
  const { build: viteBuild } = await extensionBuildDependencyLoader.importVite()
  const { svelte, vitePreprocess } =
    await extensionBuildDependencyLoader.importSvelte()

  await viteBuild({
    root: join(projectRoot, `src/${page}`),
    configFile: false,
    base: './',
    publicDir: false,
    plugins: [svelte({ preprocess: vitePreprocess({ script: true }) })],
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

await ensureNodeModulesLink()
await rm(distDir, { force: true, recursive: true })
await mkdir(distDir, { recursive: true })

await Promise.all([
  buildEntrypoint('src/background/service-worker.ts', 'background'),
  buildEntrypoint('src/content/autofill.ts', 'content'),
  buildEntrypoint('src/content/companion-wasm-host.ts', 'content'),
  buildEntrypoint('src/content/authentication-route-page.ts', 'content'),
  buildEntrypoint('src/content/webauthn-content.ts', 'content'),
  buildEntrypoint('src/content/webauthn-page.ts', 'content'),
  buildEntrypoint('src/content/simple-vault-bridge.ts', 'content'),
  buildEntrypoint('src/offscreen/session.ts', 'offscreen'),
])

await Promise.all([
  buildSveltePage('popup'),
  buildChromeLocales({ appCommonLocalesRoot, distDir }),
])

const manifestArgs: CreateExtensionManifestArgs = {
  kind: ExtensionManifestBuildKind.Channel,
  version: manifestVersion,
  simpleVaultBaseUrl,
  deployment: {
    key: deployment.manifestKey,
    name: deployment.name,
    shortName: deployment.shortName,
    versionName,
  },
}

await writeFile(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(createManifest(manifestArgs), identityJsonReplacer, 2)}\n`,
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
  copyStaticFile(
    join(
      sharedRoot,
      'src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
    ),
    'content/nook_companion_wasm_bg.wasm',
  ),
  copyStaticFile(
    join(projectRoot, 'src/content/companion-wasm-host.html'),
    'content/companion-wasm-host.html',
  ),
])

console.log(`Built Nook extension at ${distDir}`)
