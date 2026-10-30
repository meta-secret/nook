import { expect, test } from './fixtures'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { Effect } from 'effect'
import { ManualPasskeyScenario } from './identity-spec-helpers'
import {
  answerPasskeyPromptBeforeJoin,
  authorizeDeviceProtection,
  connectLocalVault,
  keepIdentityWithoutVault,
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

/** How the keyring the extension joins is set up on this browser. */
enum KeyringSetup {
  /** With its first vault, which is open before the extension connects. */
  WithVault = 'with-vault',
  /** With no vault at all: the extension joins the keyring all the same. */
  WithoutVault = 'without-vault',
}

interface VaultAppsInventoryScenarioRequest {
  readonly page: Page
  readonly browser: Browser
  readonly keyring: KeyringSetup
}

/** The vaults the stubbed delivery saw, on the document's root. */
const DELIVERED_VAULTS_ATTRIBUTE = 'data-delivered-vaults'

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
      this.request.page.evaluate((attribute) => {
        // Stub only Chrome's delivery acknowledgement; the keyring approval
        // stays real.
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
                const { vaults } = message.payload
                document.documentElement.setAttribute(
                  attribute,
                  String(vaults.length),
                )
                callback({
                  ok: true,
                  eventCount: vaults.reduce(
                    (count, vault) => count + vault.eventLogRecords.length,
                    0,
                  ),
                })
              },
            },
          },
        })
      }, DELIVERED_VAULTS_ATTRIBUTE),
    )
  }

  private prepareKeyring(): Effect.Effect<void> {
    const { page, keyring } = this.request
    switch (keyring) {
      case KeyringSetup.WithVault:
        return Effect.promise(() => connectLocalVault(page))
      case KeyringSetup.WithoutVault:
        return Effect.promise(async () => {
          await keepIdentityWithoutVault(page, 'Solo')
        })
    }
  }

  /** Unlock the keyring for the request beside its card. A keyring with a
   * vault may open it on the way; one without opens none. */
  private unlockForRequest(): Effect.Effect<void> {
    const { page, keyring } = this.request
    switch (keyring) {
      case KeyringSetup.WithVault:
        return Effect.promise(() => authorizeDeviceProtection(page))
      case KeyringSetup.WithoutVault:
        return Effect.promise(async () => {
          const consent = page.getByTestId('extension-connect-consent')
          await expect(page.getByTestId('extension-request-panel')).toBeVisible(
            { timeout: UI_TIMEOUT_MS },
          )
          await page.getByTestId('extension-request-unlock').click()
          await answerPasskeyPromptBeforeJoin(page, consent)
        })
    }
  }

  /** Unlock the keyring again after a reload. */
  private unlockAfterReload(): Effect.Effect<void> {
    const { page, keyring } = this.request
    switch (keyring) {
      case KeyringSetup.WithVault:
        return Effect.promise(() => authorizeDeviceProtection(page))
      case KeyringSetup.WithoutVault:
        return Effect.promise(async () => {
          const current = page.getByTestId('identity-card').first()
          await current.getByTestId('identity-unlock').click()
          await answerPasskeyPromptBeforeJoin(
            page,
            current.and(page.locator('[data-status="unlocked"]')),
          )
          await expect(current).toHaveAttribute('data-status', 'unlocked', {
            timeout: UI_TIMEOUT_MS,
          })
        })
    }
  }

  run = Effect.fnUntraced(function* (this: VaultAppsInventoryScenario) {
    const { page, browser, keyring } = this.request
    yield* Effect.promise(() => new ManualPasskeyScenario(page).prepare())
    yield* this.prepareKeyring()
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
    yield* this.unlockForRequest()
    yield* Effect.promise(() =>
      expect(page.getByTestId('extension-connect-consent')).toBeVisible({
        timeout: UI_TIMEOUT_MS,
      }),
    )
    yield* this.acknowledgeChromeDelivery()
    yield* Effect.promise(() => approveWhenReady(page))
    yield* Effect.promise(() =>
      expect(page).toHaveURL(/\/identities\/?$/, { timeout: UI_TIMEOUT_MS }),
    )
    yield* Effect.promise(() =>
      expect(page.getByTestId('identities-hub')).toBeVisible(),
    )
    switch (keyring) {
      case KeyringSetup.WithVault:
        break
      case KeyringSetup.WithoutVault:
        // The keyring was approved with no vault open, and none to hand over.
        yield* Effect.promise(() =>
          expect(page.getByTestId('authenticated-shell')).toHaveCount(0),
        )
        yield* Effect.promise(() =>
          expect(page.locator('html')).toHaveAttribute(
            DELIVERED_VAULTS_ATTRIBUTE,
            '0',
          ),
        )
        break
    }
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
    yield* this.unlockAfterReload()
    yield* Effect.promise(() => openKeysPage(page))
    yield* Effect.promise(() =>
      expect(keys).toContainText('Nook in this browser'),
    )
    yield* Effect.promise(() => expect(keys).toContainText('Nook Extension'))
  })
}

/** Approve once the consent can continue; a loaded runner takes a while. */
async function approveWhenReady(page: Page): Promise<void> {
  const approve = page.getByTestId('approve-extension-device-btn')
  await expect(approve).toBeEnabled({ timeout: UI_TIMEOUT_MS * 3 })
  await approve.click()
}

test('lists the browser and enrolled extension after reload without a sync provider', ({
  page,
  browser,
}) =>
  Effect.runPromise(
    new VaultAppsInventoryScenario({
      page,
      browser,
      keyring: KeyringSetup.WithVault,
    }).run(),
  ))

test('connects the extension to a keyring that has no vault yet', ({
  page,
  browser,
}) =>
  Effect.runPromise(
    new VaultAppsInventoryScenario({
      page,
      browser,
      keyring: KeyringSetup.WithoutVault,
    }).run(),
  ))
