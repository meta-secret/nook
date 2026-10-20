import { expect, test, type Page, type Route } from '../fixtures'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { demoBeat } from './pilot-demo-helpers'
import { DeviceProtectionStatus } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { OpenCompanionLauncherMessageType } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  BeginExtensionPairingMessageType,
  OpenSimpleVaultMessageType,
} from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { ExtensionRuntimeRequestType } from '../../../nook-web-extension/src/lib/extension-runtime-request-type'
import { ExtensionSessionMessageType } from '../../../nook-web-extension/src/lib/extension-session-message-type'
import { PairedVaultsMessageType } from '../../../nook-web-extension/src/lib/paired-vaults'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessageType,
} from '../../../nook-web-extension/src/lib/side-panel-site'
import type {
  SiteSecretRow,
  SiteSecretSectionContent,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'

const demoDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDist = path.resolve(demoDir, '../../../nook-web-extension/dist')
const extensionRoutePrefix = '/__extension-side-panel/'
const sidePanelPage = `${extensionRoutePrefix}side-panel/index.html`

enum SidePanelDemoVaults {
  Paired = 'paired',
  None = 'none',
}

/** What the active tab of the panel's window shows. */
enum SidePanelDemoSite {
  Matches = 'matches',
  Empty = 'empty',
  NonWeb = 'non-web',
}

type SidePanelDemoSession = {
  readonly initialStatus: DeviceProtectionStatus
  readonly vaults: SidePanelDemoVaults
  readonly site: SidePanelDemoSite
}

/** One identity:vault section the demo runtime lists: its names and its
 * rows or empty line, as the worker forwards Rust's presentation. */
type SidePanelDemoSection = {
  readonly identity: string
  readonly vault: string
  readonly content: SiteSecretSectionContent
}

// The runtime below runs inside the page, where module imports do not
// exist: every message type and status it answers travels in with it.
const sidePanelDemoProtocol = {
  ensureRuntime: ExtensionRuntimeRequestType.EnsureRuntime,
  status: ExtensionSessionMessageType.Status,
  unlockPin: ExtensionSessionMessageType.UnlockPin,
  lock: ExtensionSessionMessageType.Lock,
  pairedVaults: PairedVaultsMessageType.Query,
  refreshIdentity: PairedVaultsMessageType.RefreshIdentity,
  openVault: OpenSimpleVaultMessageType.NookOpenSimpleVault,
  openLauncher: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  beginIdentityConnection: ExtensionSessionMessageType.BeginIdentityConnection,
  beginPairing: BeginExtensionPairingMessageType.NookBeginExtensionPairing,
  unlocked: DeviceProtectionStatus.Unlocked,
  pinLocked: DeviceProtectionStatus.Pin,
  pairedVaultList: SidePanelDemoVaults.Paired,
  listLogins: SidePanelSiteMessageType.ListLogins,
  fillLogin: SidePanelSiteMessageType.FillLogin,
  fillCode: SidePanelSiteMessageType.FillCode,
  codeFilled: SidePanelCodeFillKind.Filled,
  loginType: I18N_KEYS.VaultTypesLogin,
  authenticatorType: I18N_KEYS.VaultTypesAuthenticator,
  passkeyType: I18N_KEYS.VaultTypesPasskey,
  fill: I18N_KEYS.ExtensionActionFill,
  fillLoginLabel: I18N_KEYS.ExtensionActionFillLogin,
  fillCodeKey: I18N_KEYS.ExtensionActionFillCode,
  fillCodeLabel: I18N_KEYS.ExtensionActionFillCodeFor,
  emptyAny: I18N_KEYS.ExtensionActionSiteEmptyAny,
  emptyHint: I18N_KEYS.ExtensionActionSiteEmptyHint,
  vaultEmpty: I18N_KEYS.ExtensionActionSiteVaultEmpty,
  ready: SidePanelSiteListingKind.Ready,
  nonWeb: SidePanelSiteListingKind.NonWeb,
  filled: SidePanelLoginFillKind.Filled,
  siteMatches: SidePanelDemoSite.Matches,
  siteEmpty: SidePanelDemoSite.Empty,
  siteNonWeb: SidePanelDemoSite.NonWeb,
} as const

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
  const login = (
    vault: string,
    secretId: string,
    account: string,
  ): SiteSecretRow => ({
    kind: 'Login',
    item_id: {
      vault_store_id: `side-panel-demo-${vault.toLowerCase()}`,
      secret_id: secretId,
    },
    type_label_key: protocol.loginType,
    title: 'accounts.example.com',
    account,
    saved_host: 'accounts.example.com',
    action: {
      kind: 'FillLogin',
      label_key: protocol.fill,
      accessible_label_key: protocol.fillLoginLabel,
    },
  })
  // One section per paired vault, headed "identity · vault"; a vault with
  // nothing for this site keeps its section with a muted line.
  const section = (request: SidePanelDemoSection) => ({
    vault_store_id: `side-panel-demo-${request.vault.toLowerCase()}`,
    identity: { kind: 'Named', name: request.identity },
    vault: { kind: 'Named', name: request.vault },
    content: request.content,
  })
  const nothingHere: SiteSecretSectionContent = {
    kind: 'Empty',
    message_key: protocol.vaultEmpty,
  }
  const authenticator: SiteSecretRow = {
    kind: 'Authenticator',
    item_id: {
      vault_store_id: 'side-panel-demo-personal',
      secret_id: 'totp-1',
    },
    type_label_key: protocol.authenticatorType,
    title: 'Example Accounts',
    account: 'alice.martin@example.com',
    saved_host: 'accounts.example.com',
    action: {
      kind: 'FillCode',
      label_key: protocol.fillCodeKey,
      accessible_label_key: protocol.fillCodeLabel,
    },
  }
  const passkey: SiteSecretRow = {
    kind: 'Passkey',
    item_id: {
      vault_store_id: 'side-panel-demo-startup',
      secret_id: 'passkey-1',
    },
    type_label_key: protocol.passkeyType,
    title: 'Example Accounts',
    account: 'alice',
    saved_host: 'accounts.example.com',
    action: { kind: 'ViewOnly' },
  }
  const siteSections = [
    section({
      identity: 'Alice Martin',
      vault: 'Personal',
      content: {
        kind: 'Listed',
        rows: [
          login('Personal', 'login-1', 'alice.martin@example.com'),
          authenticator,
        ],
      },
    }),
    section({
      identity: 'Alice Martin',
      vault: 'Family',
      content: nothingHere,
    }),
    section({
      identity: 'Side project',
      vault: 'Startup',
      content: { kind: 'Listed', rows: [passkey] },
    }),
  ]
  const emptySections = [
    section({
      identity: 'Alice Martin',
      vault: 'Personal',
      content: nothingHere,
    }),
    section({
      identity: 'Alice Martin',
      vault: 'Family',
      content: nothingHere,
    }),
    section({
      identity: 'Side project',
      vault: 'Startup',
      content: nothingHere,
    }),
  ]
  const listing = (): unknown => {
    switch (session.site) {
      case protocol.siteMatches:
        return {
          kind: protocol.ready,
          display_host: 'accounts.example.com',
          listing: { summary: { kind: 'Listed' }, sections: siteSections },
        }
      case protocol.siteEmpty:
        return {
          kind: protocol.ready,
          display_host: 'news.example.org',
          listing: {
            summary: {
              kind: 'Empty',
              message_key: protocol.emptyAny,
              hint: { kind: 'Shown', message_key: protocol.emptyHint },
            },
            sections: emptySections,
          },
        }
      case protocol.siteNonWeb:
        return { kind: protocol.nonWeb }
    }
  }
  const answer = (type: string): unknown => {
    switch (type) {
      case protocol.ensureRuntime:
        return { ok: true }
      case protocol.listLogins:
        return listing()
      case protocol.fillLogin:
        return { kind: protocol.filled }
      case protocol.fillCode:
        return { kind: protocol.codeFilled }
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
      case protocol.beginPairing:
        // The Nook tab the service worker opened or reused.
        return { ok: true, tabId: 42 }
      case protocol.beginIdentityConnection:
        return { ok: true, start: 'current-key' }
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
      onConnectExternal: listeners,
      sendMessage: (
        message: { readonly type: string },
        callback: (response: unknown) => void,
      ) => {
        callback(answer(message.type))
      },
    },
    tabs: {
      onActivated: listeners,
      onUpdated: listeners,
      onRemoved: listeners,
      update: (tabId: number) => Promise.resolve({ id: tabId }),
    },
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

/** A browser with no Nook passkey: it refuses every lookup, as an empty
 * immediate request or a closed picker does. */
function refusePasskeyLookups(): void {
  Object.defineProperty(navigator.credentials, 'get', {
    configurable: true,
    value: async () => {
      throw new DOMException('No passkey for this request.', 'NotAllowedError')
    },
  })
}

test('sets up in place: an existing passkey or a new one, side by side', async ({
  page,
}) => {
  await page.addInitScript(refusePasskeyLookups)
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Missing,
      vaults: SidePanelDemoVaults.None,
      site: SidePanelDemoSite.Matches,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Not set up')
  await expect(
    page.getByTestId('device-protection-use-existing-choice'),
  ).toHaveText('Use my passkey')
  await expect(page.getByTestId('side-panel-lock')).toHaveCount(0)
  await expect(page.getByTestId('side-panel-manage')).toHaveCount(0)
  await expect(
    page.getByTestId('device-protection-create-new-choice'),
  ).toHaveText('Create a new passkey')
  await demoBeat(page)
  // This browser holds no Nook passkey: it answers at once, without a phone
  // or security-key dialog, and the card offers what to do next.
  await page.getByTestId('device-protection-use-existing-choice').click()
  await expect(page.getByTestId('device-protection-title')).toHaveText(
    "Didn't find your passkey?",
  )
  const create = page.getByTestId('device-protection-create-new-choice')
  await expect(create).toHaveText('Create passkey')
  await expect(create).toBeFocused()
  await demoBeat(page)
  // Creating a passkey stays an explicit step.
  await create.click()
  await expect(page.getByTestId('device-protection-setup-btn')).toHaveText(
    'Create passkey',
  )
  await demoBeat(page)
})

test('unlocks a PIN in place, shows identity · vault sections, and locks again', async ({
  page,
}) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Pin,
      vaults: SidePanelDemoVaults.Paired,
      site: SidePanelDemoSite.Matches,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Locked')
  const pin = page.getByTestId('device-protection-pin-unlock-input')
  await expect(pin).toBeFocused()
  await demoBeat(page)
  await pin.fill('123456')
  await pin.press('Enter')
  await expect(page.getByTestId('side-panel-state')).toHaveText('Unlocked')
  // Each identity:vault shows its own section; no separate identities list.
  await expect(page.getByTestId('side-panel-site-section')).toHaveCount(3)
  await expect(page.getByTestId('side-panel-identities')).toHaveCount(0)
  await expect(page.getByTestId('side-panel-connections')).toBeVisible()
  await expect(page.getByTestId('side-panel-manage')).toBeVisible()
  await demoBeat(page)
  // All connections opens in the panel: each identity's vaults, the
  // default one marked; Back returns to This site.
  await page.getByTestId('side-panel-manage').click()
  await expect(page.getByTestId('side-panel-all-connections')).toBeVisible()
  await expect(page.getByTestId('side-panel-default-vault')).toHaveCount(1)
  await demoBeat(page)
  await page.getByTestId('side-panel-connections-back').click()
  await expect(page.getByTestId('side-panel-site-section')).toHaveCount(3)
  // Connecting another identity opens the one Nook tab; the card follows
  // that tab, where the identity is created, joined or chosen.
  await page.getByTestId('side-panel-connect').click()
  await expect(page.getByTestId('side-panel-connect-card')).toBeVisible()
  await expect(page.getByTestId('side-panel-connect-step')).toHaveText(
    'Continue in the Nook tab.',
  )
  await expect(page.getByTestId('side-panel-connect-focus-tab')).toHaveText(
    'Show Nook tab',
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
      site: SidePanelDemoSite.Matches,
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
      site: SidePanelDemoSite.Matches,
    },
  })
  await expect(page.getByTestId('side-panel-state')).toHaveText('Unlocked')
  await expect(
    page.getByTestId('side-panel-connect-card').getByRole('heading'),
  ).toHaveText('No identity connected yet')
  await expect(page.getByTestId('side-panel-connect-start')).toHaveText(
    'Connect an identity',
  )
  await expect(page.getByTestId('side-panel-vault-name')).toHaveCount(0)
  // Nothing to manage yet: All connections waits for an identity.
  await expect(page.getByTestId('side-panel-manage')).toHaveCount(0)
  await demoBeat(page)
})

test('leads with This site and fills a saved login without signing in', async ({
  page,
}) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Unlocked,
      vaults: SidePanelDemoVaults.Paired,
      site: SidePanelDemoSite.Matches,
    },
  })
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'accounts.example.com',
  )
  await expect(page.getByTestId('side-panel-item')).toHaveCount(3)
  await expect(page.getByTestId('side-panel-site-group-name')).toHaveText([
    'Alice Martin · Personal',
    'Alice Martin · Family',
    'Side project · Startup',
  ])
  const sections = page.getByTestId('side-panel-site-section')
  // A vault with nothing for this site keeps its section and says so.
  await expect(
    sections.nth(1).getByTestId('side-panel-site-vault-empty'),
  ).toHaveText('Nothing for this site')
  // Only the identity that is not unlocked carries the tag.
  await expect(page.getByTestId('side-panel-site-other-identity')).toHaveCount(
    1,
  )
  await expect(
    sections.nth(2).getByTestId('side-panel-site-other-identity'),
  ).toHaveText('Locked')
  await demoBeat(page)
  await page
    .getByRole('button', {
      name: 'Fill alice.martin@example.com from Personal',
    })
    .click()
  await expect(page.getByTestId('side-panel-fill-result')).toHaveText(
    'Filled. Review the page, then sign in.',
  )
  await demoBeat(page)
})

test('names the site when it has no saved items', async ({ page }) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Unlocked,
      vaults: SidePanelDemoVaults.Paired,
      site: SidePanelDemoSite.Empty,
    },
  })
  await expect(page.getByTestId('side-panel-site-empty')).toContainText(
    'No saved items for news.example.org.',
  )
  // Every connected vault still shows, each with its muted line.
  await expect(page.getByTestId('side-panel-site-vault-empty')).toHaveText([
    'Nothing for this site',
    'Nothing for this site',
    'Nothing for this site',
  ])
  await expect(page.getByTestId('side-panel-fill')).toHaveCount(0)
  await demoBeat(page)
})

test('offers no Fill in a tab without a website', async ({ page }) => {
  await openSidePanel({
    page,
    session: {
      initialStatus: DeviceProtectionStatus.Unlocked,
      vaults: SidePanelDemoVaults.Paired,
      site: SidePanelDemoSite.NonWeb,
    },
  })
  await expect(page.getByTestId('side-panel-site-host')).toHaveText(
    'No website in this tab',
  )
  await expect(page.getByTestId('side-panel-fill')).toHaveCount(0)
  await demoBeat(page)
})
