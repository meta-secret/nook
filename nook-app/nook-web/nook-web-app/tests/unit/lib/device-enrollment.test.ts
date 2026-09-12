import { ProviderSyncFreshness } from '$app-wasm'
import type { Page } from '@playwright/test'
import { describe, expect, test, vi } from 'vitest'
import { tryGithubVaultConnect } from '../../../e2e/helpers/device-enrollment'
import { E2eSyncProviderId } from '../../../e2e/sync-provider'

type FakeLocator = {
  click: ReturnType<typeof vi.fn>
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
  const evaluate = vi.fn(async (_expression: unknown, argument?: unknown) => {
    if (
      argument &&
      typeof argument === 'object' &&
      'freshness' in argument &&
      argument.freshness === ProviderSyncFreshness.Forced
    ) {
      throw new Error('unexpected forced refresh')
    }
    return true
  })

  return {
    page: { evaluate, getByTestId } as unknown as Page,
    connectButton,
    evaluate,
  }
}

describe('device enrollment connect helpers', () => {
  test('does not refresh a joiner a second time during quick connect', async () => {
    const { page, connectButton, evaluate } = createPage()

    await tryGithubVaultConnect(page, {
      providerId: E2eSyncProviderId.GitHub,
      repoName: 'nook-e2e',
      pat: 'ghp_test_token',
    })

    expect(connectButton.click).toHaveBeenCalledOnce()
    expect(
      evaluate.mock.calls.filter(
        ([, argument]) =>
          argument &&
          typeof argument === 'object' &&
          'freshness' in argument &&
          argument.freshness === ProviderSyncFreshness.Forced,
      ),
    ).toHaveLength(0)
  })
})
