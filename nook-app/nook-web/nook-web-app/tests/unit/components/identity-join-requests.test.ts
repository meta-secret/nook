import { fireEvent, render, screen } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import initNookWasm, {
  NookVaultManager,
  type IdentityControlSnapshot,
  type IdentityJoinRequestView,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  IdentityActionOutcome,
  IdentityControlViewKind,
  IdentityJoinDecision,
  type IdentityControlView,
  type IdentityJoinAnswer,
} from '$lib/vault/identity-control.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import IdentityDevicesPanel from '../../../../nook-web-shared/src/vault-app/lib/components/identity-control/IdentityDevicesPanel.svelte'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ASKING_APP = 'app_asking'

function joinRequest(label: string): IdentityJoinRequestView {
  return {
    appId: ASKING_APP,
    label,
    requestedAt: '2026-10-27T09:00:00Z',
  }
}

function identityWith(requests: IdentityJoinRequestView[]): VaultState {
  const vault = VaultStateTestFixture.create()
  const snapshot: IdentityControlSnapshot = {
    identityId: 'idn_test',
    identityLabel: 'Personal',
    standing: 'member',
    members: [
      {
        appId: 'app_here',
        label: '',
        isCurrentInstallation: true,
        onCurrentDevice: true,
      },
    ],
    deviceCount: 1,
    joinRequests: requests,
    vaults: [],
    mounts: [],
  }
  const ready: IdentityControlView = {
    kind: IdentityControlViewKind.Ready,
    snapshot,
  }
  vault.identityControl.view = ready
  vi.spyOn(vault.identityControl, 'followOpenVault').mockResolvedValue(
    ok(IdentityActionOutcome.Completed),
  )
  return vault
}

function renderPanel(vault: VaultState): void {
  const props: ComponentProps<typeof IdentityDevicesPanel> = { vault }
  render(IdentityDevicesPanel, props)
}

describe('devices asking to join the identity', () => {
  test('the Devices page lists a device asking to join, with its name', () => {
    const vault = identityWith([joinRequest('Work laptop')])
    renderPanel(vault)

    const row = screen.getByTestId('identity-join-request')
    expect(row.dataset.appId).toBe(ASKING_APP)
    expect(row.textContent).toContain('Work laptop')
    expect(screen.getByTestId('identity-join-requests').textContent).toContain(
      vault.t(I18N_KEYS.IdentityControlJoinRequestsTitle),
    )
  })

  test('an unnamed device is listed as an unnamed app', () => {
    const vault = identityWith([joinRequest('')])
    renderPanel(vault)

    expect(screen.getByTestId('identity-join-request').textContent).toContain(
      vault.t(I18N_KEYS.IdentityControlUnnamedApp),
    )
  })

  test('nothing is listed when no device asks', () => {
    const vault = identityWith([])
    renderPanel(vault)

    expect(screen.queryAllByTestId('identity-join-requests')).toHaveLength(0)
  })

  test('approve and deny answer that device', async () => {
    const vault = identityWith([joinRequest('Work laptop')])
    const answers: IdentityJoinAnswer[] = []
    vi.spyOn(vault.identityControl, 'answerJoin').mockImplementation(
      (answer) => {
        answers.push(answer)
        return Promise.resolve(ok(IdentityActionOutcome.Completed))
      },
    )
    renderPanel(vault)

    await fireEvent.click(screen.getByTestId('identity-join-request-approve'))
    await fireEvent.click(screen.getByTestId('identity-join-request-deny'))

    const expected: IdentityJoinAnswer[] = [
      { appId: ASKING_APP, decision: IdentityJoinDecision.Approve },
      { appId: ASKING_APP, decision: IdentityJoinDecision.Deny },
    ]
    expect(answers).toEqual(expected)
  })

  test('an answer goes to Rust and then reaches every mount', async () => {
    const vault = identityWith([joinRequest('Work laptop')])
    const manager = new NookVaultManager()
    const approved: string[] = []
    const denied: string[] = []
    vi.spyOn(manager, 'approve_identity_join').mockImplementation((appId) => {
      approved.push(appId)
      return Promise.resolve()
    })
    vi.spyOn(manager, 'deny_identity_join').mockImplementation((appId) => {
      denied.push(appId)
      return Promise.resolve()
    })
    vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
    VaultStateTestFixture.runStorageImmediately(vault)
    const synced = vi
      .spyOn(vault.identityControl, 'syncWithMounts')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))

    const approve: IdentityJoinAnswer = {
      appId: ASKING_APP,
      decision: IdentityJoinDecision.Approve,
    }
    const deny: IdentityJoinAnswer = {
      appId: ASKING_APP,
      decision: IdentityJoinDecision.Deny,
    }
    expect((await vault.identityControl.answerJoin(approve)).isOk()).toBe(true)
    expect(vault.successMsg).toBe(
      vault.t(I18N_KEYS.IdentityControlJoinRequestApproved),
    )
    expect((await vault.identityControl.answerJoin(deny)).isOk()).toBe(true)

    expect(approved).toEqual([ASKING_APP])
    expect(denied).toEqual([ASKING_APP])
    expect(synced).toHaveBeenCalledTimes(2)
  })
})
