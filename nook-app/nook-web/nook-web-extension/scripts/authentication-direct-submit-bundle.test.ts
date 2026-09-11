import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'

import { expect, test } from 'bun:test'

test('keeps the shared submit bridge safe across classic bundle injections', async () => {
  const fixtureRoot = await mkdtemp(
    resolve(tmpdir(), 'nook-direct-submit-bundle-'),
  )
  try {
    const bridgePath = resolve(
      import.meta.dir,
      '../../nook-web-shared/src/extension/authentication-direct-submit-bridge.ts',
    )
    const entrypoint = resolve(fixtureRoot, 'entry.ts')
    await writeFile(
      entrypoint,
      `import { authenticationSubmissionBridge } from ${JSON.stringify(bridgePath)}; void authenticationSubmissionBridge;`,
      'utf8',
    )
    const built = await Bun.build({
      entrypoints: [entrypoint],
      target: 'browser',
      format: 'esm',
      minify: false,
      splitting: false,
    })
    expect(built.success).toBe(true)
    const [output] = built.outputs
    if (!output) throw new Error('Direct-submit bridge bundle was not emitted.')
    const source = await output.text()
    const browserWorld = createContext({})

    runInContext(source, browserWorld)
    expect(() => runInContext(source, browserWorld)).not.toThrow()
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
