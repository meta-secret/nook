import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import initNookWasm, {
  DeviceProtectionStatus,
  NookVaultManager,
  type IdentityDecision,
  type NookIdentityConnectionStart,
  type NookIdentityJoinCompletion,
  type NookIdentityJoinAsk,
  type NookProviderSource,
  type ProviderIdentityChoice,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { PlannedDecision } from '$lib/components/provider-vaults/identity-plan.svelte'
import { IdentityDirectoryLoader } from '$lib/components/identities/identity-directory-loader.svelte'
import {
  IdentityJoinWaitKind,
  type WaitingIdentityJoin,
} from '$lib/vault/identity-join-wait'
import {
  IdentityJoinActions,
  IdentityJoinAsked,
  IdentityPlanActions,
  IdentityPlanFailureKind,
  IdentityPlanOutcomeKind,
  type IdentityPlanRun,
} from '$lib/vault/identity-plan-actions'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { NewIdentityStage } from '$lib/vault/state/ui.svelte'
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
/** The identity has no known name: it is called by its three words. */
const LABEL = 'ripple-canvas-orbit'

function family(decisions: IdentityDecision[]): ProviderIdentityChoice {
  return {
    identity: {
      identityId: IDENTITY,
      shortId: 'familyid',
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', 'orbit'],
      log: { state: 'absent' },
    },
    standing: { kind: 'unchecked' },
    decisions,
    setup: { kind: 'requestToJoin' },
    vaults: [],
  }
}

function plan(decision: IdentityDecision): IdentityPlanRun {
  const planned: PlannedDecision = {
    choice: family(['leave', decision]),
    decision,
  }
  return { source: SOURCE, planned: [planned] }
}

/** A session whose manager answers the join calls, and what they saw. */
class JoinSession {
  readonly vault: VaultState = VaultStateTestFixture.create()
  readonly manager = new NookVaultManager()
  readonly requested: string[] = []
  readonly cancelled: string[] = []

  constructor(start: NookIdentityConnectionStart) {
    vi.spyOn(this.vault, 'admitManager').mockReturnValue(ok(this.manager))
    VaultStateTestFixture.runStorageImmediately(this.vault)
    vi.spyOn(this.manager, 'begin_identity_join').mockResolvedValue(start)
    vi.spyOn(this.manager, 'request_identity_join').mockImplementation(
      (source, identityId) => {
        this.requested.push(`${source.kind}:${identityId}`)
        const requested: NookIdentityJoinAsk = {
          state: 'requested',
          identityId,
          appId: 'app_fresh',
          requestedAt: '2026-10-28T08:00:00Z',
        }
        return Promise.resolve(requested)
      },
    )
    vi.spyOn(this.manager, 'cancel_local_identity_creation').mockImplementation(
      () => {
        this.cancelled.push('staged')
      },
    )
  }

  unlocked(): this {
    this.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    return this
  }

  completes(state: NookIdentityJoinCompletion['state']): void {
    const completion: NookIdentityJoinCompletion = { state }
    vi.spyOn(this.manager, 'complete_identity_join').mockResolvedValue(
      completion,
    )
  }
}

describe('asking to join from an identity plan', () => {
  test('a browser with no protected key hands the join to the device protection gate', async () => {
    const session = new JoinSession('current-key')

    const ran = await new IdentityPlanActions(session.vault).run(
      plan('askToJoin'),
    )

    const wait: WaitingIdentityJoin = {
      kind: IdentityJoinWaitKind.Device,
      join: { source: SOURCE, identityId: IDENTITY, label: LABEL },
    }
    expect(ran._unsafeUnwrap()).toEqual({
      kind: IdentityPlanOutcomeKind.WaitsForKey,
      wait,
    })
    expect(session.vault.identityJoin).toEqual(wait)
    expect(session.requested).toEqual([])
  })

  test('a fresh unlocked key asks at once', async () => {
    const session = new JoinSession('current-key').unlocked()

    const ran = await new IdentityPlanActions(session.vault).run(
      plan('askToJoin'),
    )

    expect(ran._unsafeUnwrap().kind).toBe(IdentityPlanOutcomeKind.Applied)
    expect(session.requested).toEqual([`googleDrive:${IDENTITY}`])
    expect(session.vault.successMsg).toBe(
      session.vault.t(I18N_KEYS.AccessCheckJoinRequested),
    )
    expect(session.vault.identityJoin.kind).toBe(IdentityJoinWaitKind.Idle)
  })

  test('a key that belongs to an identity waits for a new identity of its own', async () => {
    const session = new JoinSession('new-key-staged').unlocked()

    const ran = await new IdentityPlanActions(session.vault).run(
      plan('askToJoin'),
    )

    expect(ran._unsafeUnwrap().kind).toBe(IdentityPlanOutcomeKind.WaitsForKey)
    expect(session.vault.identityJoin.kind).toBe(IdentityJoinWaitKind.NewKey)
    // The new identity's key ceremony opens, named after the identity.
    expect(session.vault.newIdentity).toBe(NewIdentityStage.Key)
    expect(session.vault.newIdentityName).toBe(LABEL)
    expect(session.requested).toEqual([])
  })

  test('the gate made a key: the join asks with it', async () => {
    const session = new JoinSession('current-key').unlocked()
    const wait: WaitingIdentityJoin = {
      kind: IdentityJoinWaitKind.Device,
      join: { source: SOURCE, identityId: IDENTITY, label: LABEL },
    }
    session.vault.identityJoin = wait

    const resumed = await new IdentityJoinActions(session.vault).resume(wait)

    expect(resumed._unsafeUnwrap()).toBe(IdentityJoinAsked.Requested)
    expect(session.requested).toEqual([`googleDrive:${IDENTITY}`])
    expect(session.vault.identityJoin.kind).toBe(IdentityJoinWaitKind.Idle)
  })

  test('a new key a member key here added joins at once and follows the identity', async () => {
    const session = new JoinSession('current-key').unlocked()
    const joined: NookIdentityJoinAsk = { state: 'joined' }
    vi.spyOn(session.manager, 'request_identity_join').mockResolvedValue(joined)
    const reload = vi
      .spyOn(IdentityDirectoryLoader.prototype, 'reload')
      .mockResolvedValue()
    const follow = vi
      .spyOn(session.vault.identityControl, 'followInviteJoin')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))
    const wait: WaitingIdentityJoin = {
      kind: IdentityJoinWaitKind.NewKey,
      join: { source: SOURCE, identityId: IDENTITY, label: LABEL },
    }
    session.vault.identityJoin = wait

    const resumed = await new IdentityJoinActions(session.vault).resume(wait)

    expect(resumed._unsafeUnwrap()).toBe(IdentityJoinAsked.Joined)
    expect(reload).toHaveBeenCalledOnce()
    expect(follow).toHaveBeenCalledWith(LABEL)
    // Nothing waits for a device: no request was announced.
    expect(session.vault.successMsg).not.toBe(
      session.vault.t(I18N_KEYS.AccessCheckJoinRequested),
    )
    expect(session.vault.identityJoin.kind).toBe(IdentityJoinWaitKind.Idle)
  })

  test('a new key that still cannot ask stops the join instead of another ceremony', async () => {
    const session = new JoinSession('new-key-staged').unlocked()
    const wait: WaitingIdentityJoin = {
      kind: IdentityJoinWaitKind.NewKey,
      join: { source: SOURCE, identityId: IDENTITY, label: LABEL },
    }
    session.vault.identityJoin = wait

    const resumed = await new IdentityJoinActions(session.vault).resume(wait)

    expect(resumed._unsafeUnwrapErr().kind).toBe(IdentityPlanFailureKind.Join)
    expect(session.cancelled).toEqual(['staged'])
    expect(session.requested).toEqual([])
    expect(session.vault.identityJoin.kind).toBe(IdentityJoinWaitKind.Idle)
  })

  test('a refused request stops the plan with the join failure', async () => {
    const session = new JoinSession('current-key').unlocked()
    vi.spyOn(session.manager, 'request_identity_join').mockRejectedValue(
      new Error('already a member'),
    )

    const ran = await new IdentityPlanActions(session.vault).run(
      plan('askToJoin'),
    )

    expect(ran._unsafeUnwrapErr().translationKey).toBe(
      I18N_KEYS.ProviderIdentitiesJoinFailed,
    )
  })
})

describe('finishing a join a device approved', () => {
  test('an approved join adds the identity and follows it like an invite join', async () => {
    const session = new JoinSession('current-key').unlocked()
    session.completes('approved')
    const reload = vi
      .spyOn(IdentityDirectoryLoader.prototype, 'reload')
      .mockResolvedValue()
    const follow = vi
      .spyOn(session.vault.identityControl, 'followInviteJoin')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))

    const ran = await new IdentityPlanActions(session.vault).run(
      plan('finishJoining'),
    )

    expect(ran._unsafeUnwrap().kind).toBe(IdentityPlanOutcomeKind.Applied)
    expect(session.manager.complete_identity_join).toHaveBeenCalledWith(
      SOURCE,
      IDENTITY,
    )
    expect(reload).toHaveBeenCalledOnce()
    expect(follow).toHaveBeenCalledWith(LABEL)
  })

  test('a pending or denied join fails closed with its reason', async () => {
    const pending = new JoinSession('current-key').unlocked()
    pending.completes('pending')
    const waiting = await new IdentityPlanActions(pending.vault).run(
      plan('finishJoining'),
    )
    expect(waiting._unsafeUnwrapErr().translationKey).toBe(
      I18N_KEYS.ProviderIdentitiesJoinPending,
    )

    const denied = new JoinSession('current-key').unlocked()
    denied.completes('denied')
    const refused = await new IdentityPlanActions(denied.vault).run(
      plan('finishJoining'),
    )
    expect(refused._unsafeUnwrapErr().translationKey).toBe(
      I18N_KEYS.ProviderIdentitiesJoinDenied,
    )
  })
  test('a refusal from Rust says what failed and why', async () => {
    const session = new JoinSession('current-key').unlocked()
    const reason =
      'This key already belongs to identity idn_local; join another identity with its own key.'
    vi.spyOn(session.manager, 'complete_identity_join').mockRejectedValue(
      new Error(reason),
    )

    const ran = await new IdentityPlanActions(session.vault).run(
      plan('finishJoining'),
    )

    const failure = ran._unsafeUnwrapErr()
    expect(failure.translationKey).toBe(
      I18N_KEYS.ProviderIdentitiesFinishJoinFailed,
    )
    const message = failure.message(session.vault)
    expect(message).toContain(
      session.vault.t(I18N_KEYS.ProviderIdentitiesFinishJoinFailed),
    )
    expect(message).toContain(reason)
  })
})
