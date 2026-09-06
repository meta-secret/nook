import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import playwrightConfig from '../playwright.config'

const extensionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const mockAuthSource = path.join(extensionRoot, 'e2e/mock-auth/src')
const mockAuthVitestFiles = readdirSync(mockAuthSource, {
  encoding: 'utf8',
  recursive: true,
})
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => path.posix.join('mock-auth/src', file))
  .sort()

describe('extension Playwright discovery', () => {
  test('ignores mock-auth Vitest files while retaining extension specs', () => {
    expect(playwrightConfig.testDir).toBe('e2e')
    expect(playwrightConfig.testMatch).toBe('**/*.spec.ts')
    expect(Object.hasOwn(playwrightConfig, 'testIgnore')).toBe(false)
    expect(
      existsSync(
        path.join(extensionRoot, 'e2e/mock-auth-pilot-coverage.spec.ts'),
      ),
    ).toBe(true)
    expect(mockAuthVitestFiles).toEqual(
      expect.arrayContaining([
        'mock-auth/src/lib/apple-auth-flow.test.ts',
        'mock-auth/src/lib/google-auth-flow.test.ts',
        'mock-auth/src/lib/openai-auth-flow.test.ts',
        'mock-auth/src/lib/x-auth-flow.test.ts',
      ]),
    )
    expect(
      mockAuthVitestFiles.every((file) =>
        /^mock-auth\/src\/.*\.test\.ts$/u.test(file),
      ),
    ).toBe(true)
    expect(
      /^mock-auth\/src\/.*\.test\.ts$/u.test(
        'mock-auth-pilot-coverage.spec.ts',
      ),
    ).toBe(false)
  })
})
