import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  S3ConnectAvailability,
  S3ConnectionAlertKind,
  S3ConnectionFailureKind,
  S3ConnectionFrame,
  S3ConnectionProgress,
  S3ConnectionSubmit,
  type S3ConnectionAlert,
} from '$lib/components/s3-connection-form'
import S3ConnectionPanel from '../../../../nook-web-shared/src/vault-app/lib/components/S3ConnectionPanel.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { requireButtonElement, requireInputElement } from '../test-dom-helpers'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

type PanelProps = ComponentProps<typeof S3ConnectionPanel>

/** What the helpers read from a rendered form. */
type FormView = {
  readonly getByTestId: (testId: string) => HTMLElement
}

/** The S3 form on the first-run step, with translation keys as its text. */
class PanelFixture {
  static readonly NO_ALERT: S3ConnectionAlert = {
    kind: S3ConnectionAlertKind.None,
  }
  readonly vault = VaultStateTestFixture.create()
  readonly onConnect = vi.fn<PanelProps['onConnect']>()

  constructor() {
    vi.spyOn(this.vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
  }

  props(alert: S3ConnectionAlert): PanelProps {
    return {
      vault: this.vault,
      idPrefix: 'unit',
      frame: S3ConnectionFrame.Panel,
      submit: S3ConnectionSubmit.Connect,
      progress: S3ConnectionProgress.Idle,
      availability: S3ConnectAvailability.Available,
      alert,
      onConnect: this.onConnect,
    }
  }

  render(alert: S3ConnectionAlert) {
    return render(S3ConnectionPanel, this.props(alert))
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
  test('Rust names every wrong field at once, focus goes to the first, and nothing connects', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render(PanelFixture.NO_ALERT)

    await fireEvent.click(view.getByTestId('first-run-s3-connect'))

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
    expect(endpoint.getAttribute('aria-describedby')).toContain(
      'unit-s3-endpoint-error',
    )
  })

  test('editing a field clears its own error and no other', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render(PanelFixture.NO_ALERT)
    await fireEvent.click(view.getByTestId('first-run-s3-connect'))

    await fireEvent.input(view.getByTestId('s3-endpoint-input'), {
      target: { value: 'https://s3.example.com' },
    })

    expect(view.queryAllByTestId('s3-endpoint-error')).toHaveLength(0)
    expect(view.getByTestId('s3-region-error')).toBeTruthy()
  })

  test('a valid form hands Rust’s configuration to the host once', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render(PanelFixture.NO_ALERT)
    await fixture.fillIn(view)

    await fireEvent.click(view.getByTestId('first-run-s3-connect'))

    expect(fixture.onConnect).toHaveBeenCalledOnce()
    expect(fixture.onConnect).toHaveBeenCalledWith(
      S3ConnectionFixture.configuration(),
    )
    expect(view.queryAllByRole('alert')).toHaveLength(0)
  })

  test('the secret is a password input with no reveal, and never in the markup', async () => {
    const fixture = new PanelFixture()
    const view = fixture.render(PanelFixture.NO_ALERT)
    await fixture.fillIn(view)

    const secret = requireInputElement(
      view.getByTestId('s3-secret-access-key-input'),
    )
    expect(secret.type).toBe('password')
    expect(secret.autocomplete).toBe('off')
    expect(secret.getAttribute('aria-describedby')).toContain(
      'unit-s3-secret-note',
    )
    for (const input of view.container.querySelectorAll('input'))
      expect(input.hasAttribute('name')).toBe(false)
    // The form's only buttons are Connect; nothing reveals the secret.
    expect(view.getAllByRole('button')).toHaveLength(1)
    expect(view.container.innerHTML).not.toContain(S3ConnectionFixture.SECRET)
  })

  test('a refused key alerts beside Connect and points the key inputs at it', () => {
    const fixture = new PanelFixture()
    const view = fixture.render({
      kind: S3ConnectionAlertKind.Shown,
      failure: S3ConnectionFailureKind.AccessDenied,
      message: 'refused',
    })

    const alert = view.getByTestId('s3-connection-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.dataset.failure).toBe('access-denied')
    expect(alert.textContent?.trim()).toBe('refused')
    for (const testId of [
      's3-access-key-id-input',
      's3-secret-access-key-input',
    ]) {
      const input = view.getByTestId(testId)
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(input.getAttribute('aria-describedby')).toContain(
        'unit-s3-connection-error',
      )
    }
    // The same refusal may mean a bucket the key cannot reach: the
    // location inputs are not marked wrong.
    expect(
      view.getByTestId('s3-bucket-input').getAttribute('aria-invalid'),
    ).toBe('false')
  })

  test('while connecting, the form waits and Connect says so', () => {
    const fixture = new PanelFixture()
    const view = render(S3ConnectionPanel, {
      ...fixture.props(PanelFixture.NO_ALERT),
      progress: S3ConnectionProgress.Connecting,
    })

    const connect = requireButtonElement(
      view.getByTestId('first-run-s3-connect'),
    )
    expect(connect.disabled).toBe(true)
    expect(connect.textContent?.trim()).toBe(I18N_KEYS.CommonConnecting)
    expect(
      requireInputElement(view.getByTestId('s3-endpoint-input')).disabled,
    ).toBe(true)
  })
})
