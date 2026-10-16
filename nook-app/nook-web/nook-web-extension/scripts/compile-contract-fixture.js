import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Type-aware ESLint builds one TypeScript program per process and keeps it.
// A file in a folder made after that program exists is found only if
// typescript-eslint notices the new folder, which a loaded release container
// sometimes misses ("not found in any of the provided project(s)"). These
// files exist before any case lints, so the program holds them from its
// first build; each case lints its own text at the same path. Each test
// file removes the folder when it ends; the next one finds it again here.
const fixtureDirectory = mkdtempSync(
  join(
    fileURLToPath(new URL('../src/', import.meta.url)),
    '__compile-contracts-',
  ),
)
writeFileSync(join(fixtureDirectory, 'contract.ts'), 'export {}\n')
writeFileSync(
  join(fixtureDirectory, 'contract.svelte'),
  '<script lang="ts"></script>\n',
)

export class CompileContractFixture {
  /** @param {'.ts' | '.svelte'} extension */
  static path(extension) {
    mkdirSync(fixtureDirectory, { recursive: true })
    return join(fixtureDirectory, `contract${extension}`)
  }

  static remove() {
    rmSync(fixtureDirectory, { recursive: true, force: true })
  }
}
