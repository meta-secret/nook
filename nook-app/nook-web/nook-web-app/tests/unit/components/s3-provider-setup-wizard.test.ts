import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { s3_provider_draft } from '$app-wasm'
import {
  DraftS3ConnectionKind,
  S3DraftReads,
} from '$lib/vault/provider-draft-reads'
import S3ProviderSetupWizard from '../../../../nook-web-shared/src/vault-app/lib/components/S3ProviderSetupWizard.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

type WizardProps = ComponentProps<typeof S3ProviderSetupWizard>
/** What the helpers read from a rendered form. */
type FormView = {
  readonly getByTestId: (testId: string) => HTMLElement
}

/** The Sync page's S3 wizard, whose host connect is a spy. */
class WizardFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly onCancelSetup = vi.fn<WizardProps['onCancelSetup']>()
  readonly onConnect = vi.fn<WizardProps['onConnect']>()

  render() {
    const props: WizardProps = {
      vault: this.vault,
      idPrefix: 'unit',
      isVerifying: false,
      isInitializing: false,
      onCancelSetup: this.onCancelSetup,
      onConnect: this.onConnect,
    }
    return render(S3ProviderSetupWizard, props)
  }

  async connect(view: FormView): Promise<void> {
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
    await fireEvent.click(view.getByTestId('connect-provider-btn'))
  }
}

describe('S3 provider setup wizard', () => {
  test('stages the validated connection before the host connects it', async () => {
    const fixture = new WizardFixture()
    const staged: DraftS3ConnectionKind[] = []
    fixture.onConnect.mockImplementation(() => {
      staged.push(S3DraftReads.connection(fixture.vault.providerDraft).kind)
    })
    const view = fixture.render()

    await fixture.connect(view)

    expect(fixture.onConnect).toHaveBeenCalledOnce()
    expect(staged).toEqual([DraftS3ConnectionKind.Ready])
    expect(fixture.vault.providerDraft).toEqual(
      s3_provider_draft(S3ConnectionFixture.configuration()),
    )
  })

  test('a failure the host reports stays beside the form, in its words', async () => {
    const fixture = new WizardFixture()
    fixture.onConnect.mockImplementation(() => {
      fixture.vault.errorMsg = 'The key was refused.'
    })
    const view = fixture.render()

    await fixture.connect(view)

    const alert = await vi.waitFor(() =>
      view.getByTestId('s3-connection-error'),
    )
    expect(alert.textContent?.trim()).toBe('The key was refused.')
  })

  test('Change provider leaves the S3 setup', async () => {
    const fixture = new WizardFixture()
    const view = fixture.render()

    await fireEvent.click(view.getByTestId('cancel-provider-setup'))

    expect(fixture.onCancelSetup).toHaveBeenCalledOnce()
  })
})
