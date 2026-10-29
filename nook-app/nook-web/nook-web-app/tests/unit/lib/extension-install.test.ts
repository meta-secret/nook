import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ExtensionInstallMethod,
  ExtensionInstallSource,
  ExtensionSetupStatus,
  extensionInstallationBrowser,
} from '$lib/extension/install'

afterEach(() => {
  document.documentElement.removeAttribute('data-nook-extension-runtime-id')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('extension install target', () => {
  test('supports installation in a desktop browser', () => {
    expect(
      extensionInstallationBrowser.browserSupportsExtensionInstallation({
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
      extensionInstallationBrowser.browserSupportsExtensionInstallation({
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
    expect(
      extensionInstallationBrowser.browserSupportsExtensionInstallation(
        environment,
      ),
    ).toBe(false)
    expect(
      extensionInstallationBrowser.shouldOfferExtensionSetup({
        status: ExtensionSetupStatus.NotInstalled,
        environment: environment,
      }),
    ).toBe(false)
    expect(
      extensionInstallationBrowser.shouldOfferExtensionSetup({
        status: ExtensionSetupStatus.Installed,
        environment: environment,
      }),
    ).toBe(true)
  })

  test('falls back to the marketing install landing page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
      })),
    )

    await expect(
      extensionInstallationBrowser.loadExtensionInstallTarget(),
    ).resolves.toEqual({
      installMethod: ExtensionInstallMethod.ManualZip,
      installUrl: extensionInstallationBrowser.extensionInstallLandingUrl(),
      source: ExtensionInstallSource.Fallback,
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
          install_method: ExtensionInstallMethod.ChromeWebStore,
          install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
        }),
      })),
    )

    await expect(
      extensionInstallationBrowser.loadExtensionInstallTarget(),
    ).resolves.toEqual({
      installMethod: ExtensionInstallMethod.ChromeWebStore,
      installUrl: `https://chromewebstore.google.com/detail/${extensionId}`,
      channel: 'production',
      version: '1.2.3',
      source: ExtensionInstallSource.Metadata,
    })
  })

  test('opens the resolved install URL', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)

    const installUrl =
      'https://chromewebstore.google.com/detail/abcdefghijklmnopqrstuvwxyzabcdef'
    extensionInstallationBrowser.openExtensionInstallTarget({
      installMethod: ExtensionInstallMethod.ChromeWebStore,
      installUrl,
      source: ExtensionInstallSource.Metadata,
    })

    expect(open).toHaveBeenCalledWith(
      installUrl,
      '_blank',
      'noopener,noreferrer',
    )
  })
})

describe('extension setup status', () => {
  test('reports not_installed when the content-script attribute is missing', () => {
    expect(extensionInstallationBrowser.resolveExtensionSetupState()).toEqual({
      status: ExtensionSetupStatus.NotInstalled,
    })
  })

  test('reports installed when the extension marks this page', () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-1',
    )

    expect(extensionInstallationBrowser.resolveExtensionSetupState()).toEqual({
      status: ExtensionSetupStatus.Installed,
    })
  })
})
