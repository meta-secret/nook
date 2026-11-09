import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  s3_provider_draft,
  type ProviderVaultListing,
  type ProviderVaultSummary,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  DraftS3ConnectionKind,
  S3DraftReads,
} from '$lib/vault/provider-draft-reads'
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstRunSyncStep from '../../../../nook-web-shared/src/vault-app/lib/components/login/FirstRunSyncStep.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

const wasm = vi.hoisted(() => ({ listS3Vaults: vi.fn() }))

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  list_s3_vaults: wasm.listS3Vaults,
}))

afterEach(() => {
  vi.restoreAllMocks()
  wasm.listS3Vaults.mockReset()
})

/** What the first-run helpers read from the rendered step. */
type StepView = {
  readonly getByTestId: (testId: string) => HTMLElement
}

/** The Sync step on a fresh browser, with translation keys as its text. */
class SyncStepFixture {
  readonly vault = VaultStateTestFixture.create()

  constructor() {
    vi.spyOn(this.vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    this.vault.firstRun = FirstRunStage.Sync
  }

  render() {
    const props = {
      vault: this.vault,
    } satisfies ComponentProps<typeof FirstRunSyncStep>
    return render(FirstRunSyncStep, props)
  }

  /** Picks S3 and connects the fixture's location. */
  async connect(view: StepView): Promise<void> {
    await fireEvent.click(view.getByTestId('first-run-s3-option'))
    const draft = S3ConnectionFixture.draft()
    const values: ReadonlyArray<readonly [string, string]> = [
      ['s3-endpoint-input', draft.endpoint],
      ['s3-region-input', draft.region],
      ['s3-bucket-input', draft.bucket],
      ['s3-key-prefix-input', draft.keyPrefix],
      ['s3-access-key-id-input', draft.accessKeyId],
      ['s3-secret-access-key-input', draft.secretAccessKey],
    ]
    for (const [testId, value] of values)
      await fireEvent.input(view.getByTestId(testId), { target: { value } })
    await fireEvent.click(view.getByTestId('first-run-s3-connect'))
  }
}

/** A keyring this browser's fresh key is not a member of. */
function strangerVault(): ProviderVaultSummary {
  return {
    storeId: 'store_strangerabc',
    shortId: 'stranger',
    name: { state: 'unknown' },
    identity: {
      identityId: 'idn_strangerabc',
      shortId: 'stranger',
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', 'orbit'],
      log: {
        state: 'read',
        devices: 1,
        newestDevice: { state: 'unreported' },
        vaults: 1,
        recoveryPassphrases: 0,
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

function listing(vaults: ProviderVaultSummary[]): ProviderVaultListing {
  return { vaults, identities: [] }
}

describe('first-run Sync step on S3 storage', () => {
  test('S3 swaps the providers for its form, and Change provider brings them back', async () => {
    const fixture = new SyncStepFixture()
    const view = fixture.render()

    await fireEvent.click(view.getByTestId('first-run-s3-option'))

    expect(view.getByTestId('first-run-s3-setup')).toBeTruthy()
    expect(view.queryAllByTestId('first-run-providers')).toHaveLength(0)
    expect(document.activeElement).toBe(view.getByTestId('s3-endpoint-input'))

    await fireEvent.click(view.getByTestId('cancel-provider-setup'))

    const row = await vi.waitFor(() => view.getByTestId('first-run-s3-option'))
    expect(document.activeElement).toBe(row)
    expect(view.getByTestId('first-run-google-sign-in')).toBeTruthy()
  })

  test('a listed location is staged once, says where it is without the secret, and offers its keyrings', async () => {
    wasm.listS3Vaults.mockResolvedValue(listing([strangerVault()]))
    const fixture = new SyncStepFixture()
    const view = fixture.render()

    await fixture.connect(view)

    const location = await vi.waitFor(() =>
      view.getByTestId('first-run-s3-location'),
    )
    expect(wasm.listS3Vaults).toHaveBeenCalledOnce()
    expect(wasm.listS3Vaults.mock.calls[0]?.[0]).toEqual(
      S3ConnectionFixture.configuration(),
    )
    expect(fixture.vault.providerDraft).toEqual(
      s3_provider_draft(S3ConnectionFixture.configuration()),
    )
    expect(location.textContent).toContain('S3 · nook-dev/e2e')
    expect(location.textContent).toContain('127.0.0.1:8333 · device-a')
    expect(view.container.innerHTML).not.toContain(S3ConnectionFixture.SECRET)
    expect(view.getAllByTestId('setup-identity')).toHaveLength(1)
    expect(view.getByTestId('setup-identity-join')).toBeTruthy()
    expect(view.getByTestId('first-run-create-new-identity')).toBeTruthy()
  })

  test('an empty location leads with creating the keyring', async () => {
    wasm.listS3Vaults.mockResolvedValue(listing([]))
    const fixture = new SyncStepFixture()
    const view = fixture.render()

    await fixture.connect(view)

    const empty = await vi.waitFor(() =>
      view.getByTestId('first-run-identities-empty'),
    )
    expect(empty.textContent?.trim()).toBe(I18N_KEYS.FirstRunSyncEmptyS3)
    const create = view.getByTestId('first-run-create-new-identity')
    expect(create.tagName).toBe('BUTTON')
    expect(create.textContent?.trim()).toBe(I18N_KEYS.FirstRunSyncCreateTitle)
  })

  test('a refused key stays on the form and says what to check', async () => {
    // Rust rejects a refused key with its translation key as the message.
    wasm.listS3Vaults.mockRejectedValue(
      new Error(I18N_KEYS.ErrorsS3KeyAccessDenied),
    )
    const fixture = new SyncStepFixture()
    const view = fixture.render()

    await fixture.connect(view)

    const alert = await vi.waitFor(() =>
      view.getByTestId('s3-connection-error'),
    )
    expect(alert.textContent?.trim()).toBe(I18N_KEYS.ErrorsS3KeyAccessDenied)
    expect(view.getByTestId('first-run-s3-setup')).toBeTruthy()
    // Nothing is staged until the location lists.
    expect(S3DraftReads.connection(fixture.vault.providerDraft).kind).toBe(
      DraftS3ConnectionKind.NotReady,
    )
  })
})
