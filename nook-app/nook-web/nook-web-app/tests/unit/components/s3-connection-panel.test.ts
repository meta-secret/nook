import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import S3ConnectionPanel from '../../../../nook-web-shared/src/vault-app/lib/components/S3ConnectionPanel.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { requireInputElement } from '../test-dom-helpers'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

type PanelProps = ComponentProps<typeof S3ConnectionPanel>

/** What the helpers read from a rendered form. */
type FormView = {
  readonly getByTestId: (testId: string) => HTMLElement
}

/** The S3 form, with translation keys as its text. */
class PanelFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly onConnect = vi.fn<PanelProps['onConnect']>()

  constructor() {
    vi.spyOn(this.vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
  }

  render(error: string) {
    const props: PanelProps = {
      vault: this.vault,
      idPrefix: 'unit',
      framed: true,
      submitLabel: 'connect',
      submitTestId: 's3-connect',
      busy: false,
      busyLabel: 'connecting',
      error,
      onConnect: this.onConnect,
    }
    return render(S3ConnectionPanel, props)
  }

  /** Types the fixture's whole connection into the form. */
  async fillIn(view: FormView): Promise<void> {
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
  }
}

describe('S3 connection form', () => {
  test('Rust names each wrong field under it, focus goes to the first, and nothing connects', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render('')

    await fireEvent.click(view.getByTestId('s3-connect'))

    expect(fixture.onConnect).not.toHaveBeenCalled()
    expect(view.getByTestId('s3-endpoint-error').textContent?.trim()).toBe(
      I18N_KEYS.ErrorsValidationS3EndpointRequired,
    )
    expect(view.getByTestId('s3-bucket-error').textContent?.trim()).toBe(
      I18N_KEYS.ErrorsValidationS3BucketRequired,
    )
    expect(
      view.getByTestId('s3-secret-access-key-error').textContent?.trim(),
    ).toBe(I18N_KEYS.ErrorsValidationS3SecretAccessKeyRequired)
    // The key prefix is optional: an empty one is the bucket root.
    expect(view.queryAllByTestId('s3-key-prefix-error')).toHaveLength(0)
    const endpoint = view.getByTestId('s3-endpoint-input')
    expect(document.activeElement).toBe(endpoint)
    expect(endpoint.getAttribute('aria-invalid')).toBe('true')
    expect(endpoint.getAttribute('aria-describedby')).toBe(
      view.getByTestId('s3-endpoint-error').id,
    )
  })

  test('a valid form hands Rust’s configuration to the host once', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render('')
    await fixture.fillIn(view)

    await fireEvent.click(view.getByTestId('s3-connect'))

    expect(fixture.onConnect).toHaveBeenCalledOnce()
    expect(fixture.onConnect).toHaveBeenCalledWith(
      S3ConnectionFixture.configuration(),
    )
    expect(view.queryAllByRole('alert')).toHaveLength(0)
  })

  test('the secret is a password input with no reveal, and never in the markup', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render('')
    await fixture.fillIn(view)

    const secret = requireInputElement(
      view.getByTestId('s3-secret-access-key-input'),
    )
    expect(secret.type).toBe('password')
    expect(secret.autocomplete).toBe('off')
    for (const input of view.container.querySelectorAll('input'))
      expect(input.hasAttribute('name')).toBe(false)
    // The form's only button besides the dev build's local-server fill is
    // its action; nothing reveals the secret.
    const buttons = view
      .getAllByRole('button')
      .filter((button) => button.dataset.testid !== 's3-use-local-dev')
    expect(buttons).toHaveLength(1)
    expect(view.container.innerHTML).not.toContain(S3ConnectionFixture.SECRET)
  })

  test('a refused key is said in one alert beside the action', () => {
    const fixture = new PanelFixture()
    const view = fixture.render(I18N_KEYS.ErrorsS3KeyAccessDenied)

    const alert = view.getByTestId('s3-connection-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent?.trim()).toBe(I18N_KEYS.ErrorsS3KeyAccessDenied)
    expect(view.getAllByRole('alert')).toHaveLength(1)
  })

  test('another S3 server offers no key link until a known service is picked', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render('')

    expect(view.queryAllByTestId('s3-create-key-link')).toHaveLength(0)

    await fireEvent.click(view.getByTestId('s3-service-wasabi'))

    const link = view.getByTestId('s3-create-key-link')
    expect(link.getAttribute('href')).toBe(
      'https://console.wasabisys.com/#/access_keys',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(
      requireInputElement(view.getByTestId('s3-region-input')).placeholder,
    ).toBe('us-east-1')
  })

  test('a typed endpoint on a known service selects it and links its key console', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render('')

    await fireEvent.input(view.getByTestId('s3-endpoint-input'), {
      target: { value: 'https://0123abcd.r2.cloudflarestorage.com' },
    })

    const r2 = view.getByTestId('s3-service-cloudflare-r2')
    expect(r2.getAttribute('aria-checked')).toBe('true')
    expect(view.getByTestId('s3-create-key-link').getAttribute('href')).toBe(
      'https://dash.cloudflare.com/?to=/:account/r2/overview',
    )

    // The local server is another S3 server: the pick stays.
    await fireEvent.input(view.getByTestId('s3-endpoint-input'), {
      target: { value: 'http://127.0.0.1:8333' },
    })
    expect(r2.getAttribute('aria-checked')).toBe('true')
  })
})
