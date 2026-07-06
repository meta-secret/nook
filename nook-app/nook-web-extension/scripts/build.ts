import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json'
import { createManifest } from '../src/manifest'

const projectRoot = resolve(import.meta.dir, '..')
const appRoot = resolve(projectRoot, '..')
const distDir = join(projectRoot, 'dist')

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

await rm(distDir, { force: true, recursive: true })
await mkdir(distDir, { recursive: true })

await Promise.all([
  buildEntrypoint('src/background/service-worker.ts', 'background'),
  buildEntrypoint('src/content/autofill.ts', 'content'),
  buildEntrypoint('src/popup/main.ts', 'popup'),
])

await writeFile(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(createManifest(packageJson.version), null, 2)}\n`,
)

await Promise.all([
  copyStaticFile(join(projectRoot, 'src/popup/index.html'), 'popup/index.html'),
  copyStaticFile(join(projectRoot, 'src/popup/popup.css'), 'popup/popup.css'),
  copyStaticFile(
    join(appRoot, 'nook-web/public/favicon.png'),
    'icons/nook.png',
  ),
])

console.log(`Built Nook extension at ${distDir}`)
