import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import initNookWasm, {
  DeviceProtectionStatus,
  NookVaultManager,
  type NookIdentityJoinCompletion,
  type NookIdentityJoinRequested,
  type NookProviderSource,
  type ProviderIdentityChoice,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { DeviceIdentityInitializationSnapshot } from '$lib/vault/action-contexts'
import {
  FirstRunActions,
  FirstRunIdentityAction,
  type FirstRunIdentityRun,
} from '$lib/vault/first-run'
import { FirstRunJoinKind } from '$lib/vault/identity-join-wait'
import { FirstRunPlace, FirstRunStage } from '$lib/vault/state/ui.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

const IDENTITY = 'idn_familyident'
const SOURCE: NookProviderSource = {
  kind: 'googleDrive',
  accessToken: 'drive-token',
}

/** An identity in the Drive folder this browser's key is not a member of. */
function locked(): ProviderIdentityChoice {
  return {
    identity: {
      identityId: IDENTITY,
      shortId: 'familyid',
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', 'orbit'],
      log: { state: 'absent' },
    },
    standing: { kind: 'unchecked' },
    decisions: ['leave', 'addToBrowser', 'askToJoin'],
    setup: { kind: 'requestToJoin' },
    vaults: [],
  }
}

/** A first-run browser whose passkey made its key, with a manager that
 * answers the calls setup makes. */
class Setup {
  readonly vault: VaultState = VaultStateTestFixture.create()
  readonly manager = new NookVaultManager()
  readonly created: string[] = []

  constructor() {
    vi.spyOn(this.vault, 'admitManager').mockReturnValue(ok(this.manager))
    VaultStateTestFixture.runStorageImmediately(this.vault)
    this.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    const key: DeviceIdentityInitializationSnapshot = {
      deviceId: 'app_fresh',
      devicePublicKey: 'age1fresh',
    }
    vi.spyOn(this.vault, 'initDeviceIdentity').mockResolvedValue(ok(key))
    vi.spyOn(this.vault, 'createLocalVaultWithDeviceKeys').mockImplementation(
      (label) => {
        this.created.push(label)
        return Promise.resolve()
      },
    )
    vi.spyOn(this.manager, 'begin_identity_join').mockResolvedValue(
      'current-key',
    )
    vi.spyOn(this.manager, 'request_identity_join').mockImplementation(
      (_source, identityId) => {
        const requested: NookIdentityJoinRequested = {
          identityId,
          appId: 'app_fresh',
          requestedAt: '2026-10-28T08:00:00Z',
        }
        return Promise.resolve(requested)
      },
    )
  }

  at(stage: FirstRunStage): this {
    this.vault.firstRun = stage
    return this
  }

  completes(state: NookIdentityJoinCompletion['state']): void {
    const completion: NookIdentityJoinCompletion = { state }
    vi.spyOn(this.manager, 'complete_identity_join').mockResolvedValue(
      completion,
    )
  }
}

function ask(): FirstRunIdentityRun {
  return {
    choice: locked(),
    source: SOURCE,
    action: FirstRunIdentityAction.AskToJoin,
  }
}

describe('first-run setup settles the identity before any vault', () => {
  test('during setup the passkey only makes the key, and the sync provider comes next', async () => {
    const setup = new Setup().at(FirstRunStage.Protect)

    await new FirstRunActions(setup.vault).createWithDeviceKeys('Personal')

    expect(setup.vault.firstRun).toBe(FirstRunStage.Sync)
    expect(setup.created).toEqual([])
  })

  test('a key ready a second time while setup is past it creates no vault', async () => {
    const setup = new Setup().at(FirstRunStage.Protect)
    const actions = new FirstRunActions(setup.vault)

    // An extension's key arrives through its approval and its queued request.
    await actions.createWithDeviceKeys('Personal')
    await actions.createWithDeviceKeys('Personal')

    expect(setup.vault.firstRun).toBe(FirstRunStage.Sync)
    expect(setup.created).toEqual([])
  })

  test('outside setup a ready key creates the vault as before', async () => {
    const setup = new Setup().at(FirstRunStage.Off)

    await new FirstRunActions(setup.vault).createWithDeviceKeys('Travel')

    expect(setup.created).toEqual(['Travel'])
    expect(setup.vault.firstRun).toBe(FirstRunStage.Off)
  })

  test('an identity the key is not a member of is asked to join, and setup waits', async () => {
    const setup = new Setup().at(FirstRunStage.Sync)

    await new FirstRunActions(setup.vault).runOn(ask())

    expect(setup.vault.firstRun).toBe(FirstRunStage.Joining)
    expect(setup.vault.firstRunJoin).toEqual({
      kind: FirstRunJoinKind.Asked,
      join: {
        source: SOURCE,
        identityId: IDENTITY,
        label: 'ripple-canvas-orbit',
      },
    })
    expect(setup.created).toEqual([])
  })

  test('a join no device answered yet keeps waiting and says so', async () => {
    const setup = new Setup().at(FirstRunStage.Sync)
    await new FirstRunActions(setup.vault).runOn(ask())
    setup.completes('pending')

    await new FirstRunActions(setup.vault).checkJoin()

    expect(setup.vault.firstRun).toBe(FirstRunStage.Joining)
    expect(setup.vault.errorMsg).toBe(
      setup.vault.t(I18N_KEYS.ProviderIdentitiesJoinPending),
    )
  })

  test('backing out of a join returns to the identities and forgets it', async () => {
    const setup = new Setup().at(FirstRunStage.Sync)
    const actions = new FirstRunActions(setup.vault)
    await actions.runOn(ask())

    actions.backToSync()

    expect(setup.vault.firstRun).toBe(FirstRunStage.Sync)
    expect(setup.vault.firstRunJoin).toEqual({ kind: FirstRunJoinKind.None })
  })

  test('a new identity kept on this browser is named next', () => {
    const setup = new Setup().at(FirstRunStage.Sync)

    new FirstRunActions(setup.vault).nameNew(FirstRunPlace.ThisBrowser)

    expect(setup.vault.firstRun).toBe(FirstRunStage.Name)
    expect(setup.vault.firstRunPlace).toBe(FirstRunPlace.ThisBrowser)
  })

  test('a name the identity cannot take creates no vault', async () => {
    const setup = new Setup().at(FirstRunStage.Name)
    vi.spyOn(setup.manager, 'name_fresh_identity').mockRejectedValue(
      new Error('already in use'),
    )

    await new FirstRunActions(setup.vault).createNamed('Family')

    expect(setup.created).toEqual([])
    expect(setup.vault.errorMsg).toBe(
      setup.vault.t(I18N_KEYS.FirstRunNameFailed),
    )
  })

  test('a named identity gets its first vault under the same name', async () => {
    const setup = new Setup().at(FirstRunStage.Name)
    const named: string[] = []
    vi.spyOn(setup.manager, 'name_fresh_identity').mockImplementation(
      (label) => {
        named.push(label)
        return Promise.resolve()
      },
    )

    await new FirstRunActions(setup.vault).createNamed('  Family  ')

    expect(named).toEqual(['Family'])
    expect(setup.created).toEqual(['Family'])
  })
})
