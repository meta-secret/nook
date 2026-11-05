import { fireEvent, render, screen } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { err, ok } from 'neverthrow'
import initNookWasm, {
  NookVaultManager,
  type IdentityControlSnapshot,
  type IdentityRecoveryPassphraseView,
  type NookRecoveryWordsCheck,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  IdentityActionOutcome,
  IdentityControlViewKind,
  type IdentityControlView,
  type RecoveryPassphraseRemoval,
  type RecoveryPassphraseRequest,
} from '$lib/vault/identity-control.svelte'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import type { VaultState } from '$lib/vault.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import RecoveryPassphrases from '../../../../nook-web-shared/src/vault-app/lib/components/recovery-passphrase/RecoveryPassphrases.svelte'
import VaultDevicesCard from '../../../../nook-web-shared/src/vault-app/lib/components/settings/VaultDevicesCard.svelte'
import {
  KeysCoverageKind,
  keysCoverage,
  keysCoverageMessage,
  type KeysCoverageRequest,
} from '../../../../nook-web-shared/src/vault-app/lib/components/identity-control/identity-keys-coverage'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const WORDS = ['amber', 'canyon', 'harbor', 'meadow']

const SAFE: IdentityRecoveryPassphraseView = {
  id: 'app_recoverysafe',
  label: 'Paper in the safe',
  strength: 'high',
}

/** A keyring this app is a member of, with its recovery passphrases. */
class KeyringFixture {
  readonly vault: VaultState = VaultStateTestFixture.create()
  readonly begun: RecoveryPassphraseRequest[] = []
  readonly typed: string[] = []
  readonly removed: RecoveryPassphraseRemoval[] = []
  readonly checks: NookRecoveryWordsCheck[] = []

  constructor(passphrases: IdentityRecoveryPassphraseView[]) {
    const snapshot: IdentityControlSnapshot = {
      identityId: 'idn_test',
      identityLabel: 'Personal',
      standing: 'member',
      members: [],
      devices: [],
      deviceCount: 1,
      joinRequests: [],
      vaults: [],
      mounts: [],
      recoveryPassphrases: passphrases,
    }
    const ready: IdentityControlView = {
      kind: IdentityControlViewKind.Ready,
      snapshot,
    }
    const control = this.vault.identityControl
    control.view = ready
    vi.spyOn(control, 'loadSnapshot').mockResolvedValue(
      ok(IdentityActionOutcome.Completed),
    )
    vi.spyOn(control, 'beginRecoveryPassphrase').mockImplementation(
      (request) => {
        this.begun.push(request)
        return Promise.resolve(ok({ words: WORDS }))
      },
    )
    vi.spyOn(control, 'confirmRecoveryPassphrase').mockImplementation(
      (words) => {
        this.typed.push(words)
        const [next] = this.checks.splice(0, 1)
        const check: NookRecoveryWordsCheck = next
          ? next
          : { state: 'accepted' }
        return Promise.resolve(ok(check))
      },
    )
    vi.spyOn(control, 'removeRecoveryPassphrase').mockImplementation(
      (removal) => {
        this.removed.push(removal)
        return Promise.resolve(ok(IdentityActionOutcome.Completed))
      },
    )
  }

  render(): void {
    const props: ComponentProps<typeof RecoveryPassphrases> = {
      vault: this.vault,
    }
    render(RecoveryPassphrases, props)
  }

  /** Name the passphrase, pick High, and generate its words. */
  async generate(): Promise<void> {
    await fireEvent.click(screen.getByTestId('recovery-passphrase-add'))
    await fireEvent.input(
      screen.getByTestId('recovery-passphrase-label-input'),
      {
        target: { value: 'Kitchen drawer' },
      },
    )
    await fireEvent.click(
      screen.getByTestId('recovery-passphrase-strength-choice-high'),
    )
    await fireEvent.click(screen.getByTestId('recovery-passphrase-generate'))
    await vi.waitFor(() => screen.getByTestId('recovery-passphrase-words'))
  }

  async typeBack(words: string): Promise<void> {
    await fireEvent.input(
      screen.getByTestId('recovery-passphrase-confirm-words'),
      { target: { value: words } },
    )
    await fireEvent.click(screen.getByTestId('recovery-passphrase-confirm'))
  }
}

function message(): HTMLElement {
  return screen.getByTestId('recovery-passphrase-confirm-words-message')
}

describe('recovery passphrases on the keyring', () => {
  test('each row names a passphrase and its strength', () => {
    const fixture = new KeyringFixture([SAFE])
    fixture.render()

    const row = screen.getByTestId('recovery-passphrase')
    expect(row.dataset.id).toBe(SAFE.id)
    expect(
      screen.getByTestId('recovery-passphrase-label').textContent,
    ).toContain(SAFE.label)
    expect(
      screen.getByTestId('recovery-passphrase-strength').textContent,
    ).toContain(fixture.vault.t(I18N_KEYS.RecoveryPassphraseStrengthHigh))
  })

  test('adding shows the words once, then saves only the words typed back', async () => {
    const fixture = new KeyringFixture([])
    fixture.render()

    await fixture.generate()

    expect(fixture.begun).toEqual([
      { label: 'Kitchen drawer', strength: 'high' },
    ])
    expect(
      screen
        .getAllByTestId('recovery-passphrase-word')
        .map((word) => word.textContent),
    ).toEqual(WORDS)

    await fireEvent.click(screen.getByTestId('recovery-passphrase-written'))
    expect(screen.queryAllByTestId('recovery-passphrase-word')).toHaveLength(0)

    fixture.checks.push({ state: 'wrongWords' })
    await fixture.typeBack('amber canyon harbor valley')
    await vi.waitFor(() =>
      expect(message().textContent).toBe(
        fixture.vault.t(I18N_KEYS.RecoveryPassphraseCheckNotShown),
      ),
    )
    expect(screen.getByTestId('recovery-passphrase-add-flow')).toBeTruthy()

    await fixture.typeBack(WORDS.join(' '))
    await vi.waitFor(() =>
      expect(
        screen.queryAllByTestId('recovery-passphrase-add-flow'),
      ).toHaveLength(0),
    )
    expect(fixture.typed).toEqual([
      'amber canyon harbor valley',
      WORDS.join(' '),
    ])
    const saved: Parameters<typeof fixture.vault.t>[0] = {
      key: I18N_KEYS.RecoveryPassphraseSaved,
      replacements: { label: 'Kitchen drawer' },
    }
    expect(fixture.vault.successMsg).toBe(fixture.vault.t(saved))
  })

  test('a word the list does not hold is named by its place', async () => {
    const fixture = new KeyringFixture([])
    fixture.render()
    await fixture.generate()
    await fireEvent.click(screen.getByTestId('recovery-passphrase-written'))

    fixture.checks.push({ state: 'unknownWords', positions: [1, 3] })
    await fixture.typeBack('amber canyn harbor medow')

    const named: Parameters<typeof fixture.vault.t>[0] = {
      key: I18N_KEYS.RecoveryPassphraseCheckUnknown,
      replacements: { positions: '2, 4' },
    }
    await vi.waitFor(() =>
      expect(message().textContent).toBe(fixture.vault.t(named)),
    )
    expect(
      screen
        .getByTestId('recovery-passphrase-confirm-words')
        .getAttribute('aria-invalid'),
    ).toBe('true')
  })

  test('cancelling drops the pending passphrase in Rust', async () => {
    const fixture = new KeyringFixture([])
    const cancelled = vi
      .spyOn(fixture.vault.identityControl, 'cancelRecoveryPassphrase')
      .mockImplementation(() => {})
    fixture.render()
    await fixture.generate()

    await fireEvent.click(screen.getByTestId('recovery-passphrase-cancel'))

    expect(cancelled).toHaveBeenCalledOnce()
    expect(screen.getByTestId('recovery-passphrase-add')).toBeTruthy()
  })

  test('removing asks first, then removes that passphrase', async () => {
    const fixture = new KeyringFixture([SAFE])
    fixture.render()

    await fireEvent.click(screen.getByTestId('recovery-passphrase-remove'))
    expect(fixture.removed).toEqual([])
    await fireEvent.click(
      screen.getByTestId('recovery-passphrase-remove-confirm-btn'),
    )

    expect(fixture.removed).toEqual([{ id: SAFE.id, label: SAFE.label }])
  })

  test('suggestions come from the word list and complete the word', async () => {
    const fixture = new KeyringFixture([])
    fixture.render()
    await fixture.generate()
    await fireEvent.click(screen.getByTestId('recovery-passphrase-written'))

    const field = screen.getByTestId('recovery-passphrase-confirm-words')
    await fireEvent.input(field, { target: { value: 'amber ca' } })
    const [first] = screen.getAllByTestId(
      'recovery-passphrase-confirm-words-suggestion',
    )
    if (!first) throw new Error('no suggestion for "ca"')
    const word = first.dataset.word
    if (!word) throw new Error('a suggestion names no word')
    expect(word.startsWith('ca')).toBe(true)

    await fireEvent.click(first)

    expect(field).toHaveProperty('value', `amber ${word} `)
  })
})

describe('the device list', () => {
  test('names the recovery passphrase that let a device in', () => {
    const vault = VaultStateTestFixture.create()
    const props: ComponentProps<typeof VaultDevicesCard> = {
      vault,
      members: [
        {
          appId: 'app_recovered',
          label: 'New laptop',
          isCurrentInstallation: true,
          onCurrentDevice: true,
          approvedBy: {
            kind: 'recoveryPassphrase',
            appId: SAFE.id,
            label: SAFE.label,
          },
        },
        {
          appId: 'app_founder',
          label: 'Old phone',
          isCurrentInstallation: false,
          onCurrentDevice: false,
          approvedBy: { kind: 'founder' },
        },
      ],
      isBusy: false,
      onRenameApp: () => Promise.resolve(ok(IdentityActionOutcome.Completed)),
      onRevokeApp: () => Promise.resolve(ok(IdentityActionOutcome.Completed)),
    }
    render(VaultDevicesCard, props)

    const tags = screen.getAllByTestId('device-recovered-by')
    expect(tags).toHaveLength(1)
    const named: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.RecoveryPassphraseApprovedBy,
      replacements: { label: SAFE.label },
    }
    expect(tags[0]?.textContent).toContain(vault.t(named))
  })
})

describe('saving accepted words', () => {
  test('accepted words stay saved when copying them to the providers fails', async () => {
    const vault = VaultStateTestFixture.create()
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'confirm_recovery_passphrase').mockResolvedValue({
      state: 'accepted',
    })
    vi.spyOn(vault, 'admitManager').mockReturnValue(ok(manager))
    VaultStateTestFixture.runStorageImmediately(vault)
    const failure = new NativeVaultStorageFailure('provider unreachable')
    vi.spyOn(vault.identityControl, 'syncWithMounts').mockResolvedValue(
      err(failure),
    )
    const reloaded = vi
      .spyOn(vault.identityControl, 'loadSnapshot')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))

    const confirmed =
      await vault.identityControl.confirmRecoveryPassphrase('amber canyon')

    expect(confirmed.isOk() && confirmed.value).toEqual({ state: 'accepted' })
    expect(reloaded).toHaveBeenCalled()
    expect(vault.errorMsg).toBe(vault.t(failure.translationKey))
  })

  test('the add flow closes on saved words and leaves the copy failure shown', async () => {
    const fixture = new KeyringFixture([])
    vi.spyOn(
      fixture.vault.identityControl,
      'confirmRecoveryPassphrase',
    ).mockImplementation(() => {
      fixture.vault.errorMsg = 'copy failed'
      const accepted: NookRecoveryWordsCheck = { state: 'accepted' }
      return Promise.resolve(ok(accepted))
    })
    fixture.render()
    await fixture.generate()
    await fireEvent.click(screen.getByTestId('recovery-passphrase-written'))

    await fixture.typeBack(WORDS.join(' '))

    await vi.waitFor(() =>
      expect(
        screen.queryAllByTestId('recovery-passphrase-add-flow'),
      ).toHaveLength(0),
    )
    expect(fixture.vault.errorMsg).toBe('copy failed')
  })
})

describe('what the Keys page says about one key', () => {
  function snapshot(
    passphrases: IdentityRecoveryPassphraseView[],
  ): IdentityControlSnapshot {
    return {
      identityId: 'idn_test',
      identityLabel: 'Personal',
      standing: 'member',
      members: [],
      devices: [],
      deviceCount: 1,
      joinRequests: [],
      vaults: [],
      mounts: [],
      recoveryPassphrases: passphrases,
    }
  }

  test('one key with a recovery passphrase says a new device can get in', () => {
    const request: KeysCoverageRequest = {
      keyCount: 1,
      snapshot: snapshot([SAFE]),
    }
    const coverage = keysCoverage(request)

    expect(coverage).toBe(KeysCoverageKind.SingleRecoverable)
    expect(keysCoverageMessage(coverage)).toBe(
      I18N_KEYS.IdentityKeysSingleRecoverable,
    )
  })

  test('one key and no recovery passphrase still warns', () => {
    const without: KeysCoverageRequest = {
      keyCount: 1,
      snapshot: snapshot([]),
    }
    const unloaded: KeysCoverageRequest = { keyCount: 1, snapshot: false }

    expect(keysCoverageMessage(keysCoverage(without))).toBe(
      I18N_KEYS.IdentityKeysSingleWarning,
    )
    expect(keysCoverage(unloaded)).toBe(KeysCoverageKind.Single)
  })

  test('several keys are covered whatever the passphrases', () => {
    const request: KeysCoverageRequest = {
      keyCount: 2,
      snapshot: snapshot([]),
    }

    expect(keysCoverage(request)).toBe(KeysCoverageKind.Covered)
  })
})
