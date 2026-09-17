// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import type { Locator } from '@playwright/test'
import {
  isJoinerVaultReady,
  tryJoinerQuickConnect,
} from '../../../e2e/helpers/device-enrollment'

type FakeLocator = {
  click: Locator['click']
  first: () => FakeLocator
  isVisible: () => Promise<boolean>
}

function createPage() {
  const connectButton: FakeLocator = {
    click: vi.fn(async () => {}),
    first: () => connectButton,
    isVisible: async () => true,
  }
  const hiddenLocator = (): FakeLocator => ({
    click: vi.fn(async () => {}),
    first: () => hiddenLocator(),
    isVisible: async () => false,
  })
  const getByTestId = vi.fn((testId: string) =>
    testId === 'connect-provider-btn' ? connectButton : hiddenLocator(),
  )
  return { connectButton, getByTestId }
}

describe('device enrollment connect helpers', () => {
  test('settles a quick-connect joiner without starting a forced refresh', async () => {
    const { connectButton } = createPage()
    const waitForIdle = vi.fn(async () => {})
    const connected = await tryJoinerQuickConnect(connectButton, waitForIdle)

    expect(connected).toBe(true)
    expect(connectButton.click).toHaveBeenCalledOnce()
    expect(waitForIdle).toHaveBeenCalledOnce()
  })

  test('accepts the authenticated shell when the route-specific vault panel is absent', () => {
    expect(
      isJoinerVaultReady({
        authenticatedShellVisible: true,
        loginGateVisible: false,
      }),
    ).toBe(true)
  })

  test('rejects an authenticated shell while the login gate is visible', () => {
    expect(
      isJoinerVaultReady({
        authenticatedShellVisible: true,
        loginGateVisible: true,
      }),
    ).toBe(false)
  })
})
