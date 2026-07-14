import { cp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const webRoot = resolve(import.meta.dir, '../..')
const previewRoot = join(webRoot, 'nook-web-app/dist')

for (const appKind of ['simple', 'sentinel'] as const) {
  const source = join(webRoot, `nook-vault-${appKind}/dist`)
  const destination = join(previewRoot, appKind)
  await rm(destination, { force: true, recursive: true })
  await cp(source, destination, { recursive: true })
}

console.log('Assembled /simple/ and /sentinel/ preview artifacts.')
