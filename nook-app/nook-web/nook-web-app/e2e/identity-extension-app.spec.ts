import { expect, test } from './fixtures'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { Effect } from 'effect'
import { ManualPasskeyScenario } from './identity-spec-helpers'
import {
  authorizeDeviceProtection,
  connectLocalVault,
  UI_TIMEOUT_MS,
  openKeysPage,
} from './helpers'
import { installMockPasskeyRuntime } from './passkey-mock'
import type { ExtensionPairingApprovedMessage } from '../../nook-web-shared/src/extension/runtime-messages'

interface ExtensionInventoryDevice {
  readonly deviceId: string
  readonly devicePublicKey: string
  readonly deviceSigningPublicKey: string
}

/** Playwright's serialized browser callback reads the actual WASM public tuple. */
class BrowserInventoryDevice {
  static read(): Promise<ExtensionInventoryDevice> {
    switch (typeof window.__nookVault) {
      case 'object':
        return window.__nookVault.admitManager().match(
          async (manager) => ({
            deviceId: manager.device_id,
            devicePublicKey: manager.device_public_key,
            deviceSigningPublicKey:
              await manager.device_signing_public_key_js(),
          }),
          (failure) => {
            throw new Error(failure.translationKey)
          },
        )
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'undefined':
      case 'function':
        throw new Error('Vault debug hooks are unavailable')
    }
  }
}

interface VaultAppsInventoryScenarioRequest {
  readonly page: Page
  readonly browser: Browser
}

class VaultAppsInventoryScenario {
  constructor(private readonly request: VaultAppsInventoryScenarioRequest) {}

  private readPeer = Effect.fnUntraced(function* (context: BrowserContext) {
    yield* Effect.promise(() =>
      context.addInitScript(installMockPasskeyRuntime),
    )
    const peerPage = yield* Effect.promise(() => context.newPage())
    yield* Effect.promise(() => connectLocalVault(peerPage))
    return yield* Effect.promise(() =>
      peerPage.evaluate(BrowserInventoryDevice.read),
    )
  })

  private releasePeer(context: BrowserContext): Effect.Effect<void> {
    return Effect.promise(() => context.close())
  }

  private acknowledgeChromeDelivery(): Effect.Effect<void> {
    return Effect.promise(() =>
      this.request.page.evaluate(() => {
        // Stub only Chrome's delivery acknowledgement; vault approval stays real.
        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          value: {
            runtime: {
              sendMessage(
                _extensionId: string,
                message: ExtensionPairingApprovedMessage,
                callback: (response: {
                  readonly ok: true
                  readonly eventCount: number
                }) => void,
              ): void {
                callback({
                  ok: true,
                  eventCount: message.eventLogRecords.length,
                })
              },
            },
          },
        })
      }),
    )
  }

  run = Effect.fnUntraced(function* (this: VaultAppsInventoryScenario) {
    const { page, browser } = this.request
    yield* Effect.promise(() => new ManualPasskeyScenario(page).prepare())
    yield* Effect.promise(() => connectLocalVault(page))
    const extensionDevice = yield* Effect.acquireUseRelease(
      Effect.promise(() => browser.newContext()),
      (context) => this.readPeer(context),
      (context) => this.releasePeer(context),
    )
    const query = new URLSearchParams({
      device_id: extensionDevice.deviceId,
      device_public_key: extensionDevice.devicePublicKey,
      device_signing_public_key: extensionDevice.deviceSigningPublicKey,
      extension_id: 'inventory-test-extension',
      device_label: 'Nook Extension',
      scopes: 'vault-access,password-filling',
    })
    yield* Effect.promise(() =>
      page.goto(`/extension-connect?${query.toString()}`),
    )
    yield* Effect.promise(() => authorizeDeviceProtection(page))
    yield* Effect.promise(() =>
      expect(page.getByTestId('extension-connect-consent')).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      }),
    )
    yield* this.acknowledgeChromeDelivery()
    yield* Effect.promise(() =>
      page.getByTestId('approve-extension-device-btn').click(),
    )
    yield* Effect.promise(() =>
      expect(page).toHaveURL(/\/identities\/?$/, { timeout: UI_TIMEOUT_MS }),
    )
    yield* Effect.promise(() =>
      expect(page.getByTestId('identities-hub')).toBeVisible(),
    )
    yield* Effect.promise(() => openKeysPage(page))
    const keys = page.getByTestId('identity-keys')
    yield* Effect.promise(() =>
      expect(keys).toContainText('Nook in this browser'),
    )
    yield* Effect.promise(() => expect(keys).toContainText('Nook Extension'))

    // After a reload the identity unlocks again and still lists both apps.
    yield* Effect.promise(() => page.reload())
    yield* Effect.promise(() =>
      expect(page.getByTestId('login-gate')).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      }),
    )
    yield* Effect.promise(() => authorizeDeviceProtection(page))
    yield* Effect.promise(() => openKeysPage(page))
    yield* Effect.promise(() =>
      expect(keys).toContainText('Nook in this browser'),
    )
    yield* Effect.promise(() => expect(keys).toContainText('Nook Extension'))
  })
}

test('lists the browser and enrolled extension after reload without a sync provider', ({
  page,
  browser,
}) =>
  Effect.runPromise(new VaultAppsInventoryScenario({ page, browser }).run()))
