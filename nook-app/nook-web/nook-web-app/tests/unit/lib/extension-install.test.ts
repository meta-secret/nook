import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  browserSupportsExtensionInstallation,
  extensionInstallLandingUrl,
  loadExtensionInstallTarget,
  openExtensionInstallTarget,
  resolveExtensionSetupStatus,
  shouldOfferExtensionSetup,
} from '$lib/extension-install'

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubExtensionIdentityStatus(status: 'unavailable' | 'locked'): void {
  document.documentElement.setAttribute(
    'data-nook-extension-runtime-id',
    'extension-1',
  )
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (
        _extensionId: string,
        message: { payload: { requestId: string; vaultStoreId: string } },
        callback: (response: unknown) => void,
      ) => {
        callback({
          type: 'nook:extension-paired-vault-identity-status',
          payload: {
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
            status,
          },
        })
      },
    },
  })
}

describe('extension install target', () => {
  test('supports installation in a desktop browser', () => {
    expect(
      browserSupportsExtensionInstallation({
        maxTouchPoints: 0,
        platform: 'MacIntel',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 Safari/537.36',
        userAgentData: { mobile: false },
      }),
    ).toBe(true)
  })

  test('uses the mobile user agent fallback when client hints report desktop', () => {
    expect(
      browserSupportsExtensionInstallation({
        maxTouchPoints: 5,
        platform: 'Linux armv8l',
        userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/140 Safari/537.36',
        userAgentData: { mobile: false },
      }),
    ).toBe(false)
  })

  test.each([
    {
      label: 'Android browser',
      environment: {
        maxTouchPoints: 5,
        platform: 'Linux armv8l',
        userAgent:
          'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile Safari/537.36',
        userAgentData: { mobile: true },
      },
    },
    {
      label: 'iPhone browser',
      environment: {
        maxTouchPoints: 5,
        platform: 'iPhone',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Mobile/15E148 Safari/604.1',
      },
    },
    {
      label: 'iPadOS browser in desktop mode',
      environment: {
        maxTouchPoints: 5,
        platform: 'MacIntel',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.6 Safari/605.1.15',
      },
    },
  ])('does not support installation in an $label', ({ environment }) => {
    expect(browserSupportsExtensionInstallation(environment)).toBe(false)
    expect(shouldOfferExtensionSetup('not_installed', environment)).toBe(false)
    expect(shouldOfferExtensionSetup('installed_unpaired', environment)).toBe(
      true,
    )
  })

  test('falls back to the marketing install landing page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
      })),
    )

    await expect(loadExtensionInstallTarget()).resolves.toEqual({
      installMethod: 'manual_zip',
      installUrl: extensionInstallLandingUrl(),
      source: 'fallback',
    })
  })

  test('uses production Chrome Web Store metadata when available', async () => {
    const extensionId = 'abcdefghijklmnopqrstuvwxyzabcdef'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          channel: 'production',
          version: '1.2.3',
          extension_id: extensionId,
          install_method: 'chrome_web_store',
          install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
        }),
      })),
    )

    await expect(loadExtensionInstallTarget()).resolves.toEqual({
      installMethod: 'chrome_web_store',
      installUrl: `https://chromewebstore.google.com/detail/${extensionId}`,
      channel: 'production',
      version: '1.2.3',
      source: 'metadata',
    })
  })

  test('opens the resolved install URL', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)

    const installUrl =
      'https://chromewebstore.google.com/detail/abcdefghijklmnopqrstuvwxyzabcdef'
    openExtensionInstallTarget({
      installMethod: 'chrome_web_store',
      installUrl,
      source: 'metadata',
    })

    expect(open).toHaveBeenCalledWith(
      installUrl,
      '_blank',
      'noopener,noreferrer',
    )
  })
})

describe('extension setup status', () => {
  test('reports not_installed when the content-script attribute is missing', async () => {
    await expect(resolveExtensionSetupStatus('store-1')).resolves.toBe(
      'not_installed',
    )
  })

  test('reports installed_unpaired when the extension is present but not paired', async () => {
    stubExtensionIdentityStatus('unavailable')

    await expect(resolveExtensionSetupStatus('store-1')).resolves.toBe(
      'installed_unpaired',
    )
  })

  test('reports paired when the extension holds a locked grant', async () => {
    stubExtensionIdentityStatus('locked')

    await expect(resolveExtensionSetupStatus('store-1')).resolves.toBe('paired')
  })
})
