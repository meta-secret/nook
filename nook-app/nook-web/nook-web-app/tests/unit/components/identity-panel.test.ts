import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, { assess_identity_health } from '$app-wasm'
import {
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'
import { ok } from 'neverthrow'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentityPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identity-control/IdentityPanel.svelte'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

function cloudProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'github-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: storedGithubRepository('nook-vault'),
    githubPat: storedGithubPat('github_pat_test'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-10-24T00:00:00.000Z',
  }
}

function renderPanel(providers: StorageProvider[]) {
  const vault = VaultStateTestFixture.create()
  vault.providers = providers
  vault.providersLoaded = true
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
    expect(inside(providers, 'first-run-sync-diagram')).toBe(false)
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
    // It draws what a provider is for instead of explaining it.
    expect(
      view
        .getByTestId('identity-panel-providers')
        .contains(view.getByTestId('first-run-sync-diagram')),
    ).toBe(true)
    expect(view.queryAllByTestId('overview-open-sync')).toHaveLength(0)
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
