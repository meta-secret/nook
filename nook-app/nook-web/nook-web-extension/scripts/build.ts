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

const projectRoot = resolve(import.meta.dir, '..')
const webGroupRoot = resolve(projectRoot, '..')
const webRoot = join(webGroupRoot, 'nook-web-app')
const sharedRoot = join(webGroupRoot, 'nook-web-shared')
const coreLocalesRoot = join(webGroupRoot, '..', 'nook-core', 'locales')
const distDir = join(projectRoot, 'dist')
const requireFromWeb = createRequire(join(webRoot, 'package.json'))

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

async function buildConnectPage() {
  const { build: viteBuild } =
    await importWebDependency<typeof import('vite')>('vite')
  const { svelte } = await importWebDependency<
    typeof import('@sveltejs/vite-plugin-svelte')
  >('@sveltejs/vite-plugin-svelte')

  await viteBuild({
    root: join(projectRoot, 'src/connect'),
    configFile: false,
    base: './',
    publicDir: false,
    plugins: [svelte()],
    build: {
      outDir: join(distDir, 'connect'),
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: join(projectRoot, 'src/connect/index.html'),
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
])

await Promise.all([buildConnectPage(), buildChromeLocales()])

await writeFile(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(createManifest(packageJson.version), null, 2)}\n`,
)

await Promise.all([
  copyStaticFile(join(webRoot, 'public/favicon.png'), 'icons/nook.png'),
])

console.log(`Built Nook extension at ${distDir}`)
