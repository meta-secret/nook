import { describe, expect, test } from 'vitest'
import { shellForAlias } from '../../../../nook-web-shared/shell-alias'

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
})
