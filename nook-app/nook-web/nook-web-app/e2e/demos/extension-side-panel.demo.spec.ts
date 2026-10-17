import { expect, test, type Page, type Route } from '../fixtures'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoBeat } from './pilot-demo-helpers'
import { DeviceProtectionStatus } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { OpenCompanionLauncherMessageType } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import { OpenSimpleVaultMessageType } from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { ExtensionSessionMessageType } from '../../../nook-web-extension/src/lib/extension-session-message-type'
import { PairedVaultsMessageType } from '../../../nook-web-extension/src/lib/paired-vaults'

const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const extensionRoutePrefix = '/__extension-side-panel/'
const sidePanelPage = `${extensionRoutePrefix}side-panel/index.html`

enum SidePanelDemoVaults {
  Paired = 'paired',
  None = 'none',
}

type SidePanelDemoSession = {
  readonly initialStatus: DeviceProtectionStatus
  readonly vaults: SidePanelDemoVaults
}

// The runtime below runs inside the page, where module imports do not
// exist: every message type and status it answers travels in with it.
const sidePanelDemoProtocol = {
  status: ExtensionSessionMessageType.Status,
  unlockPin: ExtensionSessionMessageType.UnlockPin,
  lock: ExtensionSessionMessageType.Lock,
  pairedVaults: PairedVaultsMessageType.Query,
  refreshIdentity: PairedVaultsMessageType.RefreshIdentity,
  openVault: OpenSimpleVaultMessageType.NookOpenSimpleVault,
  openLauncher: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  unlocked: DeviceProtectionStatus.Unlocked,
  pinLocked: DeviceProtectionStatus.Pin,
  pairedVaultList: SidePanelDemoVaults.Paired,
}

type SidePanelDemoRuntimeArgument = SidePanelDemoSession & {
  readonly protocol: typeof sidePanelDemoProtocol
}

function installSidePanelDemoRuntime(
  session: SidePanelDemoRuntimeArgument,
): void {
  const { protocol } = session
  let status = session.initialStatus
  const device = {
    deviceId: 'side-panel-demo-device',
    devicePublicKey: 'side-panel-demo-public-key',
    deviceSigningPublicKey: 'side-panel-demo-signing-key',
  }
  const pairedVaults = [
    {
      vaultStoreId: 'side-panel-demo-personal',
      vaultName: 'Personal',
      identityLabel: 'Alice Martin',
      deviceId: device.deviceId,
      isDefault: true,
      fillsPasswords: true,
      managesPasskeys: true,
    },
    {
      vaultStoreId: 'side-panel-demo-family',
      vaultName: 'Family',
      identityLabel: 'Alice Martin',
      deviceId: device.deviceId,
      isDefault: false,
      fillsPasswords: true,
      managesPasskeys: false,
    },
    {
      vaultStoreId: 'side-panel-demo-startup',
      vaultName: 'Startup',
      identityLabel: 'Side project',
      deviceId: 'side-panel-demo-other-device',
      isDefault: false,
      fillsPasswords: true,
      managesPasskeys: false,
    },
  ]
  const answer = (type: string): unknown => {
    switch (type) {
      case protocol.status:
        return { ok: true, status, device }
      case protocol.unlockPin:
        status = protocol.unlocked
        return { ok: true, device }
      case protocol.lock:
        status = protocol.pinLocked
        return { ok: true }
      case protocol.pairedVaults:
        return {
          ok: true,
          vaults:
            session.vaults === protocol.pairedVaultList ? pairedVaults : [],
        }
      case protocol.refreshIdentity:
        return { ok: true, paired: 0, awaitingGrant: 0 }
      case protocol.openVault:
      case protocol.openLauncher:
        return { ok: true }
      default:
        return { ok: false, reason: 'demo-unhandled' }
    }
  }
  const listeners = {
    addListener: () => {},
    removeListener: () => {},
  }
  const chromeStub = {
    i18n: { getUILanguage: () => 'en' },
    runtime: {
      getURL: (resource: string) =>
        `${globalThis.location.origin}/__extension-side-panel/${resource}`,
      sendMessage: (
        message: { readonly type: string },
        callback: (response: unknown) => void,
      ) => {
        callback(answer(message.type))
      },
    },
    tabs: { onActivated: listeners, onUpdated: listeners },
    windows: {
      getCurrent: () =>
        Promise.resolve({
          id: 1,
          focused: true,
          alwaysOnTop: false,
          incognito: false,
        }),
    },
  }
  const descriptor: PropertyDescriptor = { value: chromeStub }
  Object.defineProperty(globalThis, 'chrome', descriptor)
}

type SidePanelDemoOpening = {
  readonly page: Page
  readonly session: SidePanelDemoSession
}

async function openSidePanel(request: SidePanelDemoOpening): Promise<void> {
  const { page, session } = request
  const argument: SidePanelDemoRuntimeArgument = {
    ...session,
    protocol: sidePanelDemoProtocol,
  }
  await page.addInitScript(installSidePanelDemoRuntime, argument)
  // Chrome docks the side panel at the browser edge, 320-600px wide.
  await page.setViewportSize({ width: 360, height: 720 })
  await page.goto(sidePanelPage)
  await expect(page.getByTestId('side-panel')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.route(`**${extensionRoutePrefix}**`, async (route: Route) => {
    const requestPath = new URL(route.request().url()).pathname
    const relativePath = requestPath.slice(extensionRoutePrefix.length)
    await route.fulfill({ path: path.join(extensionDist, relativePath) })
  })
})

test('sets up in place, starting from the passkey the person already has', async ({
  page,
}) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Missing,
      vaults: SidePanelDemoVaults.None,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Not set up')
  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Use my passkey')
  await expect(page.getByTestId('side-panel-lock')).toHaveCount(0)
  await expect(page.getByTestId('side-panel-manage')).toHaveCount(0)
  await demoBeat(page)
  // Creating a passkey is the explicit alternative.
  await page.getByTestId('device-protection-create-new-choice').click()
  await expect(page.getByTestId('device-protection-setup-btn')).toHaveText(
    'Create passkey',
  )
  await demoBeat(page)
})

test('unlocks a PIN in place, lists identities, and locks again', async ({
  page,
}) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Pin,
      vaults: SidePanelDemoVaults.Paired,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Locked')
  const pin = page.getByTestId('device-protection-pin-unlock-input')
  await expect(pin).toBeFocused()
  await demoBeat(page)
  await pin.fill('123456')
  await pin.press('Enter')
  await expect(page.getByTestId('side-panel-state')).toHaveText('Unlocked')
  await expect(page.getByTestId('side-panel-identity')).toHaveCount(2)
  await expect(page.getByTestId('side-panel-identities')).toContainText(
    'Alice Martin',
  )
  await expect(page.getByTestId('side-panel-manage')).toBeVisible()
  await demoBeat(page)
  // Connecting another identity continues in the Nook tab; the panel stays.
  await page.getByTestId('side-panel-connect').click()
  await expect(page.getByTestId('side-panel-handoff')).toHaveText(
    'Continue in the Nook tab.',
  )
  await demoBeat(page)
  await page.getByTestId('side-panel-lock').click()
  await expect(page.getByTestId('side-panel-state')).toHaveText('Locked')
  await expect(pin).toBeFocused()
  await demoBeat(page)
})

test('unlocks with the connected passkey in place', async ({ page }) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Passkey,
      vaults: SidePanelDemoVaults.Paired,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Locked')
  await expect(page.getByTestId('device-protection-unlock-btn')).toBeFocused()
  await demoBeat(page)
})

test('leads with connecting an identity when none is connected', async ({
  page,
}) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Unlocked,
      vaults: SidePanelDemoVaults.None,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Unlocked')
  await expect(page.getByTestId('side-panel-connect')).toHaveText(
    'Connect an identity',
  )
  await expect(page.getByTestId('side-panel-manage')).toBeVisible()
  await demoBeat(page)
})
