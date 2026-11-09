import { fireEvent, render, screen } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import initNookWasm, {
  DeviceProtectionStatus,
  NookVaultManager,
  type IdentityRecoveryPassphraseView,
  type NookProviderSource,
  type NookRecoveryWordsCheck,
  type ProviderIdentityChoice,
  type ProviderVaultSummary,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { IdentityDirectoryLoader } from '$lib/components/identities/identity-directory-loader.svelte'
import { FirstRunActions } from '$lib/vault/first-run'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import {
  FirstRunJoinKind,
  type IdentityJoinIntent,
} from '$lib/vault/identity-join-wait'
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import FirstRunRecoverStep from '../../../../nook-web-shared/src/vault-app/lib/components/login/FirstRunRecoverStep.svelte'
import FirstRunSyncStep from '../../../../nook-web-shared/src/vault-app/lib/components/login/FirstRunSyncStep.svelte'
import { VaultOAuthActions } from '$lib/vault/oauth'
import {
  ProviderDraftFixture,
  ProviderFixtureCredentials,
} from '../provider-fixtures'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

const IDENTITY = 'idn_familyident'
const SOURCE: NookProviderSource = {
  kind: 'remote',
  source: { kind: 'googleDrive', accessToken: 'drive-token' },
}
const JOIN: IdentityJoinIntent = {
  source: SOURCE,
  identityId: IDENTITY,
  label: 'ripple-canvas-orbit',
}
const PASSPHRASES: IdentityRecoveryPassphraseView[] = [
  { id: 'app_recoverysafe', label: 'Safe', strength: 'standard' },
  { id: 'app_recoverydesk', label: 'Desk drawer', strength: 'high' },
]

/** The words typed for one recovery passphrase, as Rust received them. */
type Recovery = {
  readonly identityId: string
  readonly recoveryId: string
  readonly words: string
}

/** A first-run browser whose passkey made its key, recovering a keyring
 * found on its Drive. Rust answers each attempt with the next check. */
class RecoverFixture {
  readonly vault: VaultState = VaultStateTestFixture.create()
  readonly manager = new NookVaultManager()
  readonly attempts: Recovery[] = []
  readonly checks: NookRecoveryWordsCheck[] = []
  readonly connected = vi.fn(() => Promise.resolve(true))

  constructor() {
    vi.spyOn(this.vault, 'admitManager').mockReturnValue(ok(this.manager))
    VaultStateTestFixture.runStorageImmediately(this.vault)
    this.vault.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    this.vault.firstRun = FirstRunStage.Joining
    this.vault.firstRunJoin = { kind: FirstRunJoinKind.Recovering, join: JOIN }
    vi.spyOn(this.manager, 'recovery_passphrases_at_source').mockResolvedValue({
      passphrases: PASSPHRASES,
    })
    vi.spyOn(this.manager, 'begin_identity_join').mockResolvedValue(
      'current-key',
    )
    vi.spyOn(
      this.manager,
      'recover_identity_with_passphrase',
    ).mockImplementation((_source, identityId, recoveryId, words) => {
      this.attempts.push({ identityId, recoveryId, words })
      const [next] = this.checks.splice(0, 1)
      const check: NookRecoveryWordsCheck = next ? next : { state: 'accepted' }
      return Promise.resolve(check)
    })
    vi.spyOn(IdentityDirectoryLoader.prototype, 'reload').mockResolvedValue()
    vi.spyOn(this.vault.identityControl, 'followInviteJoin').mockResolvedValue(
      ok(IdentityActionOutcome.Completed),
    )
    vi.spyOn(FirstRunActions.prototype, 'connectProvider').mockImplementation(
      this.connected,
    )
  }

  async render(): Promise<void> {
    const props: ComponentProps<typeof FirstRunRecoverStep> = {
      vault: this.vault,
      join: JOIN,
    }
    render(FirstRunRecoverStep, props)
    await vi.waitFor(() => screen.getByTestId('first-run-recover-words'))
  }

  async recover(words: string): Promise<void> {
    await fireEvent.input(screen.getByTestId('first-run-recover-words'), {
      target: { value: words },
    })
    await fireEvent.click(screen.getByTestId('first-run-recover-submit'))
  }
}

function message(): HTMLElement {
  return screen.getByTestId('first-run-recover-words-message')
}

describe('first-run recovery with a passphrase', () => {
  test('Recover with passphrase on a listed keyring opens its recover step', () => {
    const vault = VaultStateTestFixture.create()
    vault.firstRun = FirstRunStage.Sync
    const choice: ProviderIdentityChoice = {
      identity: {
        identityId: IDENTITY,
        shortId: 'familyid',
        name: { state: 'unknown' },
        words: ['ripple', 'canvas', 'orbit'],
        log: { state: 'absent' },
      },
      standing: { kind: 'unchecked' },
      decisions: [],
      setup: { kind: 'requestToJoin' },
      recovery: 'offered',
      vaults: [],
    }

    new FirstRunActions(vault).recover({ choice, source: SOURCE })

    expect(vault.firstRun).toBe(FirstRunStage.Joining)
    expect(vault.firstRunJoin).toEqual({
      kind: FirstRunJoinKind.Recovering,
      join: JOIN,
    })
  })

  test('the keyring’s passphrases are offered by label, and the picked one is tried', async () => {
    const fixture = new RecoverFixture()
    await fixture.render()

    await fireEvent.click(
      screen.getByTestId('first-run-recover-passphrase-app_recoverydesk'),
    )
    await fixture.recover('amber canyon harbor meadow valley')

    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1))
    expect(fixture.attempts).toEqual([
      {
        identityId: IDENTITY,
        recoveryId: 'app_recoverydesk',
        words: 'amber canyon harbor meadow valley',
      },
    ])
  })

  test('refused words say which, and nothing joins until Rust accepts them', async () => {
    const fixture = new RecoverFixture()
    fixture.checks.push(
      { state: 'unknownWords', positions: [2] },
      { state: 'wrongWords' },
    )
    await fixture.render()

    await fixture.recover('amber canyon harbr meadow')
    const unknown: Parameters<typeof fixture.vault.t>[0] = {
      key: I18N_KEYS.RecoveryPassphraseCheckUnknown,
      replacements: { positions: '3' },
    }
    await vi.waitFor(() =>
      expect(message().textContent).toBe(fixture.vault.t(unknown)),
    )

    await fixture.recover('amber canyon harbor meadow')
    await vi.waitFor(() =>
      expect(message().textContent).toBe(
        fixture.vault.t(I18N_KEYS.RecoveryPassphraseCheckWrong),
      ),
    )
    expect(fixture.connected).not.toHaveBeenCalled()
    expect(fixture.vault.firstRunJoin.kind).toBe(FirstRunJoinKind.Recovering)

    await fixture.recover('amber canyon harbor medal')
    await vi.waitFor(() => expect(fixture.connected).toHaveBeenCalledOnce())
    expect(fixture.vault.firstRunJoin).toEqual({ kind: FirstRunJoinKind.None })
    const recovered: Parameters<typeof fixture.vault.t>[0] = {
      key: I18N_KEYS.RecoveryPassphraseRecovered,
      replacements: { identity: JOIN.label },
    }
    expect(fixture.vault.successMsg).toBe(fixture.vault.t(recovered))
  })

  test('a key already in a keyring does not recover, and its staged key is dropped', async () => {
    const fixture = new RecoverFixture()
    vi.spyOn(fixture.manager, 'begin_identity_join').mockResolvedValue(
      'new-key-staged',
    )
    const dropped = vi
      .spyOn(fixture.manager, 'cancel_local_identity_creation')
      .mockImplementation(() => {})
    await fixture.render()

    await fixture.recover('amber canyon harbor meadow')

    await vi.waitFor(() => expect(dropped).toHaveBeenCalledOnce())
    expect(fixture.attempts).toEqual([])
    expect(fixture.vault.errorMsg).toContain(
      fixture.vault.t(I18N_KEYS.RecoveryPassphraseRecoverFailed),
    )
  })
})

/** A keyring in the signed-in Google Drive's Nook folder that this
 * browser's fresh key is not in, with one recovery passphrase. */
function recoverableOnDrive(): ProviderVaultSummary {
  return {
    storeId: 'store_familyvault',
    shortId: 'familyab',
    name: { state: 'unknown' },
    identity: {
      identityId: IDENTITY,
      shortId: 'familyid',
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', 'orbit'],
      log: {
        state: 'read',
        devices: 1,
        newestDevice: { state: 'unreported' },
        vaults: 2,
        recoveryPassphrases: 1,
        thisBrowser: false,
        join: 'notAsked',
      },
    },
    created: { state: 'reported', at: Date.UTC(2026, 9, 1) },
    lastActivity: { state: 'reported', at: Date.UTC(2026, 9, 2) },
    eventCount: 2,
    access: { state: 'locked' },
  }
}

describe('first-run recovery from Google Drive', () => {
  test('a Drive keyring with a recovery passphrase is recovered through Drive', async () => {
    vi.spyOn(
      VaultOAuthActions.prototype,
      'listGoogleDriveVaults',
    ).mockResolvedValue(
      ok({
        root: 'found',
        listing: {
          vaults: [recoverableOnDrive()],
          identities: [],
        },
      }),
    )
    const vault = VaultStateTestFixture.create()
    vault.firstRun = FirstRunStage.Sync
    vault.stageProviderDraft(ProviderDraftFixture.googleDriveSignedIn())
    const view = render(FirstRunSyncStep, { vault })

    const card = await vi.waitFor(() => view.getByTestId('setup-identity'))
    expect(card.dataset.setup).toBe('requestToJoin')
    await fireEvent.click(view.getByTestId('setup-identity-recover'))

    expect(vault.firstRun).toBe(FirstRunStage.Joining)
    const drive: NookProviderSource = {
      kind: 'remote',
      source: {
        kind: 'googleDrive',
        accessToken: ProviderFixtureCredentials.DRIVE_TOKEN,
      },
    }
    expect(vault.firstRunJoin).toEqual({
      kind: FirstRunJoinKind.Recovering,
      join: { source: drive, identityId: IDENTITY, label: JOIN.label },
    })
  })
})

describe('a recovery that joined but could not load the keyring', () => {
  test('keeps the load failure shown and announces no recovery', async () => {
    const fixture = new RecoverFixture()
    const failure = new NativeVaultStorageFailure('provider unreachable')
    vi.spyOn(
      fixture.vault.identityControl,
      'followInviteJoin',
    ).mockResolvedValue(err(failure))
    fixture.connected.mockImplementation(() => {
      // Connecting clears the page's error before it runs.
      fixture.vault.errorMsg = ''
      return Promise.resolve(true)
    })
    await fixture.render()

    await fixture.recover('amber canyon harbor meadow')

    await vi.waitFor(() => expect(fixture.connected).toHaveBeenCalledOnce())
    expect(fixture.vault.errorMsg).toBe(fixture.vault.t(failure.translationKey))
    expect(fixture.vault.successMsg).toBe('')
  })
})
