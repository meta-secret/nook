import { describe, expect, test } from 'vitest'
import { WorkspaceLocation, WorkspaceRoute } from '$lib/app/workspace-route'
import { shellForAlias } from '../../../../nook-web-shared/shell-alias'
import { VAULT_WORKSPACE_SPA_PATHS } from '../../../../nook-web-shared/vault-workspace-paths'

const shell =
  '<link rel="icon" href="./favicon.png" /><script type="module" src="./assets/index.js"></script>'

describe('route shell aliases', () => {
  test('keeps a top-level alias pointing at its sibling assets', () => {
    expect(shellForAlias(shell, 'vault')).toBe(shell)
  })

  test('points a nested alias back at the app root', () => {
    expect(shellForAlias(shell, 'identity/devices')).toBe(
      '<link rel="icon" href="../favicon.png" /><script type="module" src="../assets/index.js"></script>',
    )
  })

  test('leaves an absolute-base shell unchanged', () => {
    const absolute =
      '<script type="module" src="/app/assets/index.js"></script>'
    expect(shellForAlias(absolute, 'identity/devices')).toBe(absolute)
  })

  test('serves the app shell at every workspace page, so a reload stays in the app', () => {
    for (const route of Object.values(WorkspaceRoute)) {
      expect(VAULT_WORKSPACE_SPA_PATHS).toContain(
        new WorkspaceLocation(route).path,
      )
    }
  })
})
