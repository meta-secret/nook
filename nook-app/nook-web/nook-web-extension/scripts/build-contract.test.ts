import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'

import { expect, test } from 'bun:test'
import {
  ExtensionEntrypointBuildFormat,
  extensionEntrypointBuildPolicy,
} from './build-contract'

test('uses classic IIFE output for content scripts and module output elsewhere', () => {
  expect(
    extensionEntrypointBuildPolicy.format({
      entrypoint: 'src/content/autofill.ts',
    }),
  ).toBe(ExtensionEntrypointBuildFormat.Classic)
  expect(
    extensionEntrypointBuildPolicy.format({
      entrypoint: 'src/content/webauthn-content.ts',
    }),
  ).toBe(ExtensionEntrypointBuildFormat.Classic)
  expect(
    extensionEntrypointBuildPolicy.format({
      entrypoint: 'src/background/service-worker.ts',
    }),
  ).toBe(ExtensionEntrypointBuildFormat.Module)
})

test('emits an executable self-contained classic autofill bundle', async () => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'nook-autofill-bundle-'))
  try {
    const dependency = resolve(fixtureRoot, 'dependency.ts')
    const entrypoint = resolve(fixtureRoot, 'entry.ts')
    await writeFile(dependency, 'export const ready = true', 'utf8')
    await writeFile(
      entrypoint,
      "import { ready } from './dependency'; export const state = ready;",
      'utf8',
    )
    const built = await Bun.build({
      entrypoints: [entrypoint],
      target: 'browser',
      format: extensionEntrypointBuildPolicy.format({
        entrypoint: 'src/content/autofill.ts',
      }),
      minify: false,
      splitting: false,
    })
    expect(built.success).toBe(true)
    const [output] = built.outputs
    if (!output) throw new Error('Classic autofill bundle was not emitted.')
    const source = await output.text()
    expect(source).not.toMatch(/^\s*(import|export)\b/m)
    expect(source).not.toContain('import.meta')
    expect(source).not.toMatch(/^\s*await\b/m)
    runInContext(source, createContext({}))
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('rejects top-level await when compiling the classic autofill format', async () => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'nook-autofill-tla-'))
  try {
    const entrypoint = resolve(fixtureRoot, 'entry.ts')
    await writeFile(entrypoint, 'await Promise.resolve()', 'utf8')
    expect(() =>
      Bun.build({
        entrypoints: [entrypoint],
        target: 'browser',
        format: extensionEntrypointBuildPolicy.format({
          entrypoint: 'src/content/autofill.ts',
        }),
        minify: false,
        splitting: false,
      }),
    ).toThrow()
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
