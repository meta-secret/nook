import path from 'node:path'
import { fileURLToPath } from 'node:url'
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function failRemoteOnly(): never {
  console.error('E2E debug is hosted-only; run it through the remote Task')
  process.exit(2)
}

if (process.env.NOOK_REMOTE_E2E_DEBUG !== '1') {
  failRemoteOnly()
}

const child = Bun.spawn(
  [
    'bun',
    'x',
    'playwright',
    'test',
    '--config=playwright.config.ts',
    '--workers=1',
    '--trace=retain-on-failure',
  ],
  {
    cwd: appRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

process.exit(await child.exited)
