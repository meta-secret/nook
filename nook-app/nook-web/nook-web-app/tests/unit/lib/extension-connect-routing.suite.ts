import { describe, expect, test, vi } from 'vitest'
import { Effect } from 'effect'
import {
  ExtensionConnectIntentKind,
  ExtensionConnectionIntentProjection,
} from '$lib/app/route-state'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  ExtensionConnectRequestStateKind,
  extensionConnectionBrowser,
} from '$lib/extension/connect'
import {
  OpenCompanionLauncherMessage as OpenCompanionLauncherMessageGuard,
  OpenCompanionLauncherIntent,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { locationFromUrl } from './extension-connect-test-support'

describe('extension connect route parsing', () => {
  test('accepts the canonical extension-connect path', () => {
    expect(
      extensionConnectionBrowser.isExtensionConnectPath('/extension-connect'),
    ).toBe(true)
    expect(
      extensionConnectionBrowser.isExtensionConnectPath('/extension-connect/'),
    ).toBe(true)
    expect(extensionConnectionBrowser.isExtensionConnectPath('/vault')).toBe(
      false,
    )
  })

  test('parses complete pairing requests', () => {
    const request =
      extensionConnectionBrowser.extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&extension_id=ext-123&device_label=Nook%20Extension&nonce=n-1&scopes=vault-access,password-filling,sync-provider-credentials',
        ),
      )

    expect(request).toEqual({
      kind: ExtensionConnectRequestStateKind.Requested,
      request: {
        source: ExtensionIdentityRequestSource.ExtensionConnect,
        deviceId: 'device-1',
        devicePublicKey: 'enc-pk',
        deviceSigningPublicKey: 'sign-pk',
        extensionRuntimeId: 'ext-123',
        deviceLabel: 'Nook Extension',
        nonce: 'n-1',
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.PasswordFilling,
          ExtensionConnectScope.SyncProviderCredentials,
        ],
      },
    })
  })

  test('rejects requests that cannot deliver the grant to an extension', () => {
    const request =
      extensionConnectionBrowser.extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&nonce=n-1&scopes=vault-access',
        ),
      )

    expect(new ExtensionConnectionIntentProjection(request).intent).toEqual({
      kind: ExtensionConnectIntentKind.Absent,
    })
  })

  test('rejects the removed website-first setup link', () => {
    expect(
      new ExtensionConnectionIntentProjection(
        extensionConnectionBrowser.extensionConnectRequestFromLocation(
          locationFromUrl(
            'https://simple.nokey.sh/extension-connect?extension_id=ext-123',
          ),
        ),
      ).intent,
    ).toEqual({ kind: ExtensionConnectIntentKind.Absent })
  })
})

describe('installed extension launcher', () => {
  test('asks the detected extension to open its authenticated pairing UI', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-123',
    )
    const sendMessage = vi.fn(
      (
        extensionId: string,
        message: unknown,
        callback: (response: unknown) => void,
      ) => {
        expect(extensionId).toBe('extension-123')
        expect(message).toEqual({
          type: 'nook:open-companion-launcher',
          payload: { intent: OpenCompanionLauncherIntent.Pair },
        })
        callback({ ok: true })
      },
    )
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    })

    await expect(
      extensionConnectionBrowser.openInstalledExtension(),
    ).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  test('does not attempt to launch an extension that is no longer detected', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
    })

    await expect(
      extensionConnectionBrowser.openInstalledExtension(),
    ).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('accepts only the supported companion launcher intent', () => {
    const accepted = Effect.runSync(
      Effect.either(
        OpenCompanionLauncherMessageGuard.decode({
          type: 'nook:open-companion-launcher',
          payload: { intent: OpenCompanionLauncherIntent.Pair },
        }),
      ),
    )
    const rejected = Effect.runSync(
      Effect.either(
        OpenCompanionLauncherMessageGuard.decode({
          type: 'nook:open-companion-launcher',
          payload: { intent: 'forget-vault' },
        }),
      ),
    )
    expect(accepted._tag).toBe('Right')
    expect(rejected._tag).toBe('Left')
  })
})
