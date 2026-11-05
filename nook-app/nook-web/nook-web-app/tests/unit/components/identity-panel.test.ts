import { fireEvent, render, within } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, { assess_identity_health } from '$app-wasm'
import { type StorageProvider } from '$lib/auth/providers'
import { ProviderRowFixture } from '../provider-fixtures'
import { ok } from 'neverthrow'
import {
  IdentityActionOutcome,
  IdentityControlViewKind,
  type IdentityControlView,
} from '$lib/vault/identity-control.svelte'
import type { IdentityControlSnapshot, IdentityMemberView } from '$app-wasm'
import type { VaultState } from '$lib/vault.svelte'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentityPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identity-control/IdentityPanel.svelte'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

function cloudProvider(): StorageProvider {
  return {
    ...ProviderRowFixture.github(ProviderRowFixture.unscoped('github-1')),
    label: 'GitHub',
  }
}

function renderPanel(
  providers: StorageProvider[],
  prepare: (vault: VaultState) => void = () => {},
) {
  const vault = VaultStateTestFixture.create()
  vault.providers = providers
  vault.providersLoaded = true
  prepare(vault)
  vi.spyOn(vault.identityControl, 'followOpenVault').mockResolvedValue(
    ok(IdentityActionOutcome.Completed),
  )
  const onOpen = vi.fn()
  const onAddSyncProvider = vi.fn()
  const props = {
    vault,
    health: assess_identity_health(0, providers.length, 1, 3),
    onOpen,
    onAddSyncProvider,
  } satisfies ComponentProps<typeof IdentityPanel>
  return { view: render(IdentityPanel, props), onOpen, onAddSyncProvider }
}

describe('identity panel', () => {
  test('orders devices and sync, then management, then details', () => {
    const { view } = renderPanel([cloudProvider()])

    const sync = view.getByTestId('identity-panel-sync')
    const manage = view.getByTestId('identity-panel-manage')
    const details = view.getByTestId('identity-panel-details')
    const follows = (first: Element, second: Element) =>
      Boolean(
        first.compareDocumentPosition(second) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    expect(follows(sync, manage)).toBe(true)
    expect(follows(manage, details)).toBe(true)
    const inside = (panel: Element, testId: string) =>
      Boolean(panel.querySelector(`[data-testid="${testId}"]`))
    // Sync providers come first: a device joins through one.
    const providers = view.getByTestId('identity-panel-providers')
    const devices = view.getByTestId('identity-panel-devices')
    expect(follows(providers, devices)).toBe(true)
    expect(inside(providers, 'identity-panel-provider-github')).toBe(true)
    expect(inside(providers, 'identity-action-add-sync')).toBe(true)
    expect(inside(devices, 'identity-action-add-device')).toBe(true)
    expect(inside(manage, 'overview-open-vaults')).toBe(true)
    expect(inside(manage, 'overview-browser-settings')).toBe(true)
    expect(inside(sync, 'overview-open-devices')).toBe(true)
    expect(inside(sync, 'identity-panel-device')).toBe(true)
    expect(inside(details, 'overview-keys')).toBe(true)
  })

  test('without a cloud provider, adding one leads and adding a device waits', async () => {
    const { view, onAddSyncProvider } = renderPanel([])

    expect(
      view.getByTestId('identity-action-add-device').hasAttribute('disabled'),
    ).toBe(true)
    expect(view.getByTestId('identity-panel-providers').dataset.state).toBe(
      'risk',
    )
    expect(view.queryAllByTestId('overview-open-sync')).toHaveLength(0)
    // Adding a provider is the one lead action: everything else waits on it.
    const leads = view.container.querySelectorAll('[data-lead="true"]')
    expect([...leads].map((lead) => lead.getAttribute('data-testid'))).toEqual([
      'identity-action-add-sync',
    ])
    await fireEvent.click(view.getByTestId('identity-action-add-sync'))

    expect(onAddSyncProvider).toHaveBeenCalledOnce()
  })

  test('each action and detail opens its page', async () => {
    const { view, onOpen } = renderPanel([cloudProvider()])

    await fireEvent.click(view.getByTestId('identity-action-add-device'))
    await fireEvent.click(view.getByTestId('overview-open-sync'))
    await fireEvent.click(view.getByTestId('overview-keys'))

    expect(onOpen.mock.calls).toEqual([
      [WorkspaceSection.AddDevice],
      [WorkspaceSection.Sync],
      [WorkspaceSection.Keys],
    ])
  })
})

describe('identity panel devices', () => {
  function app(
    appId: string,
    label: string,
    current: boolean,
  ): IdentityMemberView {
    return {
      appId,
      label,
      isCurrentInstallation: current && label === 'Chrome on Mac',
      onCurrentDevice: current,
      approvedBy: { kind: 'founder' },
    }
  }

  test('groups the apps on one device into one row with their keys', () => {
    const { view } = renderPanel([cloudProvider()], (vault) => {
      const here = [
        app('app_web', 'Chrome on Mac', true),
        app('app_ext', 'Nook Extension', true),
      ]
      const other = [app('app_phone', 'Phone', false)]
      const snapshot: IdentityControlSnapshot = {
        identityId: 'idn_test',
        identityLabel: 'Personal',
        standing: 'member',
        members: [...here, ...other],
        devices: [
          { apps: here, current: true },
          { apps: other, current: false },
        ],
        deviceCount: 2,
        joinRequests: [],
        vaults: [],
        mounts: [],
        recoveryPassphrases: [],
      }
      const ready: IdentityControlView = {
        kind: IdentityControlViewKind.Ready,
        snapshot,
      }
      vault.identityControl.view = ready
    })

    const rows = view.getAllByTestId('identity-panel-device')
    expect(rows).toHaveLength(2)
    const [shared, phone] = rows
    if (!shared || !phone) throw new Error('two device rows')
    expect(shared.textContent).toContain('Chrome on Mac')
    expect(
      within(shared).getByTestId('identity-panel-device-key-count').textContent,
    ).toContain('2')
    const apps = within(shared).getByTestId('identity-panel-device-apps')
    expect(apps.querySelectorAll('li')).toHaveLength(2)
    expect(apps.textContent).toContain('Nook Extension')
    expect(
      within(phone).queryAllByTestId('identity-panel-device-apps'),
    ).toHaveLength(0)
  })
})
