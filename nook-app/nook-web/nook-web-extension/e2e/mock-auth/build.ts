import { spawnSync } from 'node:child_process'
import { accessSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))
const webAppRoot = path.resolve(fixtureRoot, '../../../nook-web-app')
const viteBin = path.join(webAppRoot, 'node_modules/.bin/vite')

try {
  accessSync(viteBin)
} catch {
  throw new Error(
    `vite not found at ${viteBin}. Link or install nook-web-app dependencies first.`,
  )
}

const result = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', 'vite.config.ts'],
  {
    cwd: fixtureRoot,
    stdio: 'inherit',
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
