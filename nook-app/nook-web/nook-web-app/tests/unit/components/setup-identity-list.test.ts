import { fireEvent, render, screen } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  type IdentitySetup,
  type IdentityStanding,
  type ProviderIdentityChoice,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { SetupRecoveryKind } from '$lib/components/provider-vaults/setup-identity-offer'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import SetupIdentityList from '../../../../nook-web-shared/src/vault-app/lib/components/provider-vaults/SetupIdentityList.svelte'

beforeAll(async () => {
  await initNookWasm()
})

afterEach(() => vi.restoreAllMocks())

/** One identity in the Drive folder, as Rust decided its setup action. */
type Listed = {
  readonly id: string
  readonly standing: IdentityStanding
  readonly setup: IdentitySetup
}

function choice({ id, standing, setup }: Listed): ProviderIdentityChoice {
  return {
    identity: {
      identityId: id,
      shortId: id,
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', id],
      log: { state: 'absent' },
    },
    standing,
    decisions: [],
    setup,
    recovery: 'notOffered',
    vaults: [],
  }
}

const MEMBER: Listed = {
  id: 'idn_memberabcd',
  standing: { kind: 'joinApproved' },
  setup: { kind: 'continue', decision: 'finishJoining' },
}
const LOCKED: Listed = {
  id: 'idn_lockedabcd',
  standing: { kind: 'unchecked' },
  setup: { kind: 'requestToJoin' },
}
const ASKED: Listed = {
  id: 'idn_askedabcde',
  standing: { kind: 'joinRequested' },
  setup: { kind: 'waiting' },
}
/** On a fresh browser, an identity its passkey's key is a member of. */
const KEY_MEMBER: Listed = {
  id: 'idn_keymemberab',
  standing: { kind: 'thisBrowser' },
  setup: { kind: 'continue', decision: 'leave' },
}
/** With an identity in use, that identity. */
const IN_USE: Listed = {
  id: 'idn_inuseabcde',
  standing: { kind: 'thisBrowser' },
  setup: { kind: 'inUse' },
}
const ELSEWHERE: Listed = {
  id: 'idn_elsewhereab',
  standing: { kind: 'otherIdentityHere', identityLabel: 'Work' },
  setup: { kind: 'unavailable' },
}

/** A keyring this browser may join whose log lists two recovery passphrases,
 * so Rust offers recovering it. */
const RECOVERABLE_ID = 'idn_recoverabl'
function withRecoveryPassphrases(
  listed: ProviderIdentityChoice,
): ProviderIdentityChoice {
  return {
    ...listed,
    identity: {
      ...listed.identity,
      log: {
        state: 'read',
        devices: 1,
        newestDevice: { state: 'unreported' },
        vaults: 2,
        recoveryPassphrases: 2,
        thisBrowser: false,
        join: 'notAsked',
      },
    },
    recovery: 'offered',
  }
}
const RECOVERABLE = withRecoveryPassphrases(
  choice({
    id: RECOVERABLE_ID,
    standing: { kind: 'unchecked' },
    setup: { kind: 'requestToJoin' },
  }),
)

/** The listing every test renders unless it names its own. */
const LISTED: readonly ProviderIdentityChoice[] = [
  ...[MEMBER, LOCKED, ASKED, ELSEWHERE, KEY_MEMBER, IN_USE].map(choice),
  RECOVERABLE,
]

class Listing {
  constructor(
    private readonly choices: readonly ProviderIdentityChoice[] = LISTED,
  ) {}

  readonly vault = VaultStateTestFixture.create()
  readonly continued: string[] = []
  readonly asked: string[] = []
  readonly checked: string[] = []
  readonly recovered: string[] = []

  render(working: string): void {
    const props: ComponentProps<typeof SetupIdentityList> = {
      vault: this.vault,
      choices: [...this.choices],
      working,
      onContinue: (picked: ProviderIdentityChoice) => {
        this.continued.push(picked.identity.identityId)
      },
      onAskToJoin: (picked: ProviderIdentityChoice) => {
        this.asked.push(picked.identity.identityId)
      },
      onCheck: (picked: ProviderIdentityChoice) => {
        this.checked.push(picked.identity.identityId)
      },
      recovery: {
        kind: SetupRecoveryKind.Offered,
        onRecover: (picked: ProviderIdentityChoice) => {
          this.recovered.push(picked.identity.identityId)
        },
      },
    }
    render(SetupIdentityList, { props })
  }
}

function card(id: string): HTMLElement {
  const found = screen
    .getAllByTestId('setup-identity')
    .find((element) => element.dataset.identityId === id)
  if (!found) throw new Error(`no card for ${id}`)
  return found
}

/** The card's one action button. */
type CardAction = { readonly id: string; readonly testId: string }

function action({ id, testId }: CardAction): HTMLElement {
  const found = card(id).querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!found) throw new Error(`no ${testId} on ${id}`)
  return found
}

describe('setup lists each identity with the one action Rust decided', () => {
  test('a key member on a fresh browser continues; the identity in use has nothing to do', async () => {
    const listing = new Listing()
    listing.render('')
    const standing = (id: string) =>
      card(id)
        .querySelector('[data-testid="provider-identity-standing"]')
        ?.textContent?.trim()

    const continueOn: CardAction = {
      id: KEY_MEMBER.id,
      testId: 'setup-identity-continue',
    }
    await fireEvent.click(action(continueOn))
    expect(listing.continued).toEqual([KEY_MEMBER.id])
    expect(standing(KEY_MEMBER.id)).toBe(
      listing.vault.t(I18N_KEYS.FirstRunIdentityMember),
    )

    expect(card(IN_USE.id).querySelectorAll('button')).toHaveLength(0)
    expect(standing(IN_USE.id)).toBe(
      listing.vault.t(I18N_KEYS.FirstRunIdentityInUse),
    )
  })

  test('a member continues, a locked identity is asked to join, an asked one is checked', async () => {
    const listing = new Listing()
    listing.render('')

    const continueOn: CardAction = {
      id: MEMBER.id,
      testId: 'setup-identity-continue',
    }
    const join: CardAction = { id: LOCKED.id, testId: 'setup-identity-join' }
    const check: CardAction = { id: ASKED.id, testId: 'setup-identity-check' }
    await fireEvent.click(action(continueOn))
    await fireEvent.click(action(join))
    await fireEvent.click(action(check))

    expect(listing.continued).toEqual([MEMBER.id])
    expect(listing.asked).toEqual([LOCKED.id])
    expect(listing.checked).toEqual([ASKED.id])
    expect(card(ELSEWHERE.id).querySelectorAll('button')).toHaveLength(0)
    expect(action(continueOn).textContent).toContain(
      listing.vault.t(I18N_KEYS.FirstRunIdentityContinue),
    )
  })

  test('while one action runs, no other can start', () => {
    const listing = new Listing()
    listing.render(LOCKED.id)

    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(true)
    }
  })
})

describe('setup offers recovering with a passphrase beside joining', () => {
  test('only a keyring Rust offers to recover shows the action', () => {
    // The log lists passphrases, but Rust did not offer recovering it.
    const listing = new Listing([{ ...RECOVERABLE, recovery: 'notOffered' }])
    listing.render('')
    expect(
      card(RECOVERABLE_ID).querySelectorAll(
        '[data-testid="setup-identity-recover"]',
      ),
    ).toHaveLength(0)
  })

  test('only a keyring whose log lists recovery passphrases offers it', async () => {
    const listing = new Listing()
    listing.render('')

    const recover: CardAction = {
      id: RECOVERABLE_ID,
      testId: 'setup-identity-recover',
    }
    expect(action(recover).textContent).toContain(
      listing.vault.t(I18N_KEYS.RecoveryPassphraseRecoverAction),
    )
    await fireEvent.click(action(recover))

    expect(listing.recovered).toEqual([RECOVERABLE_ID])
    expect(listing.asked).toEqual([])
    for (const id of [LOCKED.id, ASKED.id, MEMBER.id, ELSEWHERE.id]) {
      expect(
        card(id).querySelectorAll('[data-testid="setup-identity-recover"]'),
      ).toHaveLength(0)
    }
  })
})
