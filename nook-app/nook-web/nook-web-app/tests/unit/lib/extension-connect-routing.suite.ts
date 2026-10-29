import { describe, expect, test, vi } from 'vitest'
import { ExtensionConnectFollowKind } from '$web-shared/extension/extension-connect-progress'
import { Effect } from 'effect'
import {
  ExtensionConnectIntentKind,
  ExtensionConnectionIntentProjection,
} from '$lib/app/route-state'
import {
  ExtensionConnectScope,
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
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&extension_id=ext-123&device_label=Nook%20Extension&scopes=vault-access,password-filling,sync-provider-credentials&connect_id=connect-1',
        ),
      )

    expect(request).toEqual({
      kind: ExtensionConnectRequestStateKind.Requested,
      request: {
        follow: {
          kind: ExtensionConnectFollowKind.Named,
          connectId: 'connect-1',
        },
        deviceId: 'device-1',
        devicePublicKey: 'enc-pk',
        deviceSigningPublicKey: 'sign-pk',
        extensionRuntimeId: 'ext-123',
        deviceLabel: 'Nook Extension',
        scopes: [
          ExtensionConnectScope.VaultAccess,
          ExtensionConnectScope.PasswordFilling,
          ExtensionConnectScope.SyncProviderCredentials,
        ],
      },
    })
  })

  test('a request without a connect id still connects, followed by no panel', () => {
    const request =
      extensionConnectionBrowser.extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&extension_id=ext-123&scopes=vault-access',
        ),
      )
    switch (request.kind) {
      case ExtensionConnectRequestStateKind.Requested:
        expect(request.request).toMatchObject({
          follow: { kind: ExtensionConnectFollowKind.Unnamed },
        })
        return
      case ExtensionConnectRequestStateKind.Absent:
        throw new Error('the connect request did not parse')
    }
  })

  test('rejects requests that cannot deliver the grant to an extension', () => {
    const request =
      extensionConnectionBrowser.extensionConnectRequestFromLocation(
        locationFromUrl(
          'https://nokey.sh/extension-connect?device_id=device-1&device_public_key=enc-pk&device_signing_public_key=sign-pk&scopes=vault-access',
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

describe('connected extension side panel', () => {
  test('signals the detected extension over the vault channel and reports whether it opened', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-123',
    )
    const answers = [{ ok: true }, { ok: false, reason: 'side-panel-failed' }]
    const sendMessage = vi.fn(
      (
        extensionId: string,
        message: unknown,
        callback: (response: unknown) => void,
      ) => {
        expect(extensionId).toBe('extension-123')
        expect(message).toEqual({ type: 'nook:open-side-panel' })
        callback(answers.shift())
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.openExtensionSidePanel(),
    ).resolves.toBe(true)
    await expect(
      extensionConnectionBrowser.openExtensionSidePanel(),
    ).resolves.toBe(false)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  test('sends nothing when no extension is detected', async () => {
    document.documentElement.removeAttribute('data-nook-extension-runtime-id')
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })

    await expect(
      extensionConnectionBrowser.openExtensionSidePanel(),
    ).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('companion launcher message', () => {
  test('accepts only the supported companion launcher intent', () => {
    const accepted = Effect.runSync(
      Effect.result(
        OpenCompanionLauncherMessageGuard.decode({
          type: 'nook:open-companion-launcher',
          payload: { intent: OpenCompanionLauncherIntent.Pair },
        }),
      ),
    )
    const rejected = Effect.runSync(
      Effect.result(
        OpenCompanionLauncherMessageGuard.decode({
          type: 'nook:open-companion-launcher',
          payload: { intent: 'forget-vault' },
        }),
      ),
    )
    expect(accepted._tag).toBe('Success')
    expect(rejected._tag).toBe('Failure')
  })
})
