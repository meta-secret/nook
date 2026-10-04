// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { deviceProtectionButtonReady } from '../../../e2e/helpers/settings-auth'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('device protection control readiness', () => {
  test('observes removal between browser turns without waiting for the old control', async () => {
    const button = document.createElement('button')
    button.dataset.testid = 'unlock-vault-btn'
    document.body.append(button)
    vi.spyOn(button, 'getClientRects').mockReturnValue({
      length: 1,
      item: () => new DOMRect(),
      0: new DOMRect(),
      [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
    })
    expect(deviceProtectionButtonReady('unlock-vault-btn')).toBe(true)
    await Promise.resolve()
    button.remove()
    expect(deviceProtectionButtonReady('unlock-vault-btn')).toBe(false)
  })

  test('keeps disabled and hidden authorization controls unavailable', () => {
    const button = document.createElement('button')
    button.dataset.testid = 'device-protection-unlock-btn'
    document.body.append(button)
    vi.spyOn(button, 'getClientRects').mockReturnValue({
      length: 1,
      item: () => new DOMRect(),
      0: new DOMRect(),
      [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
    })
    button.disabled = true
    expect(deviceProtectionButtonReady('device-protection-unlock-btn')).toBe(
      false,
    )
    button.disabled = false
    button.style.visibility = 'hidden'
    expect(deviceProtectionButtonReady('device-protection-unlock-btn')).toBe(
      false,
    )
  })
})
