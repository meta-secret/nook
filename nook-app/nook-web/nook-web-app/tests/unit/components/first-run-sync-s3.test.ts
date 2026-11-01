import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ProviderVaultListing, ProviderVaultSummary } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { NativeProviderFailureCode } from '$lib/runtime/storage-failure'
import {
  S3ListingFailure,
  S3VaultInventoryKind,
  S3VaultInventoryReader,
  type S3VaultRead,
} from '$lib/components/provider-vaults/s3-vault-inventory'
import { S3DraftKind } from '$lib/vault/state/provider.svelte'
import { FirstRunStage } from '$lib/vault/state/ui.svelte'
import FirstRunSyncStep from '../../../../nook-web-shared/src/vault-app/lib/components/login/FirstRunSyncStep.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

/** What the first-run helpers read from the rendered step. */
type StepView = {
  readonly getByTestId: (testId: string) => HTMLElement
}

/** The Sync step on a fresh browser, with translation keys as its text and
 * an S3 location whose listing the test decides. */
class SyncStepFixture {
  readonly vault = VaultStateTestFixture.create()

  constructor(read: S3VaultRead) {
    vi.spyOn(this.vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    vi.spyOn(S3VaultInventoryReader.prototype, 'read').mockResolvedValue(read)
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
        thisBrowser: false,
        join: 'notAsked',
      },
    },
    created: { state: 'reported', at: Date.UTC(2026, 9, 1) },
    lastActivity: { state: 'reported', at: Date.UTC(2026, 9, 2) },
    eventCount: 2,
    access: { state: 'locked' },
    actions: ['requestAccess'],
  }
}

function listed(vaults: ProviderVaultSummary[]): S3VaultRead {
  const listing: ProviderVaultListing = {
    vaults,
    replacement: { state: 'unavailable' },
  }
  return { kind: S3VaultInventoryKind.Loaded, listing }
}

describe('first-run Sync step on S3 storage', () => {
  test('S3 swaps the providers for its form, and Change provider brings them back', async () => {
    const fixture = new SyncStepFixture(listed([]))
    const view = fixture.render()

    await fireEvent.click(view.getByTestId('first-run-s3-option'))

    expect(view.getByTestId('first-run-s3-setup')).toBeTruthy()
    expect(view.queryByTestId('first-run-providers')).toBeNull()
    expect(document.activeElement).toBe(view.getByTestId('s3-endpoint-input'))

    await fireEvent.click(view.getByTestId('cancel-provider-setup'))

    const row = await vi.waitFor(() => view.getByTestId('first-run-s3-option'))
    expect(document.activeElement).toBe(row)
    expect(view.getByTestId('first-run-google-sign-in')).toBeTruthy()
  })

  test('a listed location says where it is, without the secret, and lists its keyrings', async () => {
    const fixture = new SyncStepFixture(listed([strangerVault()]))
    const view = fixture.render()

    await fixture.connect(view)

    const location = await vi.waitFor(() =>
      view.getByTestId('first-run-s3-location'),
    )
    expect(location.textContent).toContain('S3 · nook-dev/e2e')
    expect(location.textContent).toContain('127.0.0.1:8333 · device-a')
    expect(location.textContent).not.toContain(S3ConnectionFixture.SECRET)
    expect(view.getAllByTestId('setup-identity')).toHaveLength(1)
    expect(view.getByTestId('setup-identity-join')).toBeTruthy()
    expect(fixture.vault.s3Draft.kind).toBe(S3DraftKind.Configured)
  })

  test('an empty location leads with creating the keyring', async () => {
    const fixture = new SyncStepFixture(listed([]))
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
    const refusal = Object.assign(
      new Error(I18N_KEYS.ErrorsS3KeyAccessDenied),
      {
        code: NativeProviderFailureCode.S3KeyAccessDenied,
      },
    )
    const read: S3VaultRead = {
      kind: S3VaultInventoryKind.Failed,
      failure: new S3ListingFailure(refusal),
    }
    const fixture = new SyncStepFixture(read)
    const view = fixture.render()

    await fixture.connect(view)

    const alert = await vi.waitFor(() =>
      view.getByTestId('s3-connection-error'),
    )
    expect(alert.dataset.failure).toBe('access-denied')
    expect(alert.textContent?.trim()).toBe(I18N_KEYS.ErrorsS3KeyAccessDenied)
    expect(view.getByTestId('first-run-s3-setup')).toBeTruthy()
    // Nothing is staged until the location lists.
    expect(fixture.vault.s3Draft.kind).toBe(S3DraftKind.NotConfigured)
  })
})
