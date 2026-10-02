import { expect, test } from './fixtures'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { Effect } from 'effect'
import { DevicesAccessScenario } from './devices-access-spec-helpers'
import {
  authorizeDeviceProtection,
  connectLocalVault,
  UI_TIMEOUT_MS,
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
    yield* Effect.promise(() => new DevicesAccessScenario(page).prepare())
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
      nonce: 'inventory-test-nonce',
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
      expect(page).toHaveURL(/\/vault\/?$/, { timeout: UI_TIMEOUT_MS }),
    )
    yield* Effect.promise(() =>
      page.getByTestId('header-devices-access-btn').click(),
    )
    const identity = page.getByTestId('devices-access-identity-option')
    const apps = page.getByTestId('devices-access-app')
    yield* Effect.promise(() => expect(identity).toHaveCount(1))
    yield* Effect.promise(() =>
      expect(identity).toContainText('2 apps · 1 vault'),
    )
    yield* Effect.promise(() => expect(apps).toHaveCount(2))
    yield* Effect.promise(() =>
      expect(apps.filter({ hasText: 'Nook in this browser' })).toContainText(
        'Protected by',
      ),
    )
    const extension = apps.filter({ hasText: 'Nook Extension' })
    yield* Effect.promise(() =>
      expect(extension).toContainText('Linked to Personal'),
    )
    yield* Effect.promise(() =>
      expect(extension).not.toContainText('Protected by'),
    )
    yield* Effect.promise(() =>
      expect(extension.getByTestId('devices-access-app-id')).not.toBeVisible(),
    )
    yield* Effect.promise(() =>
      page.getByTestId('devices-access-layout-graph').click(),
    )
    yield* Effect.promise(() =>
      expect(identity).toContainText('2 apps · 1 vault'),
    )

    yield* Effect.promise(() => page.reload())
    yield* Effect.promise(() =>
      expect(page.getByTestId('login-gate')).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      }),
    )
    yield* Effect.promise(() =>
      expect(page.getByTestId('devices-access-key-inventory')).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      }),
    )
    yield* Effect.promise(() =>
      expect(identity).toContainText('2 apps · 1 vault'),
    )
    yield* Effect.promise(() => expect(apps).toHaveCount(2))
    yield* Effect.promise(() =>
      expect(extension).toContainText('Nook Extension'),
    )
  })
}

test('lists the browser and enrolled extension after reload without a sync provider', ({
  page,
  browser,
}) =>
  Effect.runPromise(new VaultAppsInventoryScenario({ page, browser }).run()))
