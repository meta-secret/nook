import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { ok } from 'neverthrow'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { S3Connection } from '$app-wasm'
import type { StorageProvider } from '$lib/auth/providers'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import S3ProviderKeys from '../../../../nook-web-shared/src/vault-app/lib/components/S3ProviderKeys.svelte'
import { ProviderPersistenceOutcome } from '../../../../nook-web-shared/src/vault-app/lib/vault/providers.svelte'
import {
  S3KeyFormRequests,
  type S3KeyFormRequest,
} from '../../../../nook-web-shared/src/vault-app/lib/vault/s3-key-form-request'
import { ProviderRowFixture } from '../provider-fixtures'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

type PanelProps = ComponentProps<typeof S3ProviderKeys>

const SPARE_SECRET = 'TEST-ONLY-device-b-secret-not-real'

/** The keys panel of one saved S3 row, saving through a spied provider
 * save, with translation keys as its text. */
class KeysFixture {
  readonly vault = VaultStateTestFixture.create()
  readonly saved: StorageProvider[] = []

  constructor(readonly row: StorageProvider) {
    vi.spyOn(this.vault, 't').mockImplementation((request) =>
      typeof request === 'string' ? request : request.key,
    )
    this.vault.providers = [row]
    vi.spyOn(this.vault, 'persistProviders').mockImplementation(
      async (options) => {
        this.saved.push(...options.providers)
        return ok(ProviderPersistenceOutcome.Persisted)
      },
    )
  }

  static s3(): KeysFixture {
    return new KeysFixture(
      ProviderRowFixture.s3(ProviderRowFixture.unscoped('s3-row')),
    )
  }

  connection(row: StorageProvider): S3Connection {
    const stored = row.provider
    switch (stored.type) {
      case 's3':
        return stored
      case 'local':
      case 'local-folder':
      case 'github':
      case 'oauth-file':
        throw new Error('the fixture row is S3')
    }
  }

  render() {
    const props: PanelProps = {
      vault: this.vault,
      provider: this.row,
      connection: this.connection(this.row),
      disabled: false,
    }
    return render(S3ProviderKeys, props)
  }
}

describe('S3 provider keys', () => {
  test('Add key saves a validated spare key on the row, sealed by the provider save', async () => {
    const fixture = KeysFixture.s3()
    const view = fixture.render()
    expect(view.getByTestId('s3-key-in-use').textContent?.trim()).toBe(
      I18N_KEYS.AuthStorageS3KeyInUse,
    )
    expect(view.queryAllByTestId('s3-add-key-form')).toHaveLength(0)

    await fireEvent.click(view.getByTestId('s3-add-key-btn'))
    // A blank key names each wrong field and saves nothing.
    await fireEvent.click(view.getByTestId('s3-add-key-save'))
    expect(
      view.getByTestId('s3-add-key-access-key-id-error').textContent?.trim(),
    ).toBe(I18N_KEYS.ErrorsValidationS3AccessKeyIdRequired)
    expect(fixture.saved).toHaveLength(0)

    const secret = view.getByTestId('s3-add-key-secret-access-key-input')
    expect(secret.getAttribute('type')).toBe('password')
    expect(secret.hasAttribute('name')).toBe(false)
    await fireEvent.input(view.getByTestId('s3-add-key-access-key-id-input'), {
      target: { value: ' device-b ' },
    })
    await fireEvent.input(secret, { target: { value: SPARE_SECRET } })
    await fireEvent.click(view.getByTestId('s3-add-key-save'))

    await waitFor(() => expect(fixture.saved).toHaveLength(1))
    const [savedRow] = fixture.saved
    if (!savedRow) throw new Error('the row is saved')
    const spares = fixture.connection(savedRow).spareKeys
    expect(spares.map((spare) => spare.accessKeyId)).toEqual(['device-b'])
    expect(fixture.connection(savedRow).accessKeyId).toBe('device-a')
    await waitFor(() =>
      expect(view.queryAllByTestId('s3-add-key-form')).toHaveLength(0),
    )
  })

  test('a key the row saves already is refused', async () => {
    const fixture = KeysFixture.s3()
    const view = fixture.render()
    await fireEvent.click(view.getByTestId('s3-add-key-btn'))
    await fireEvent.input(view.getByTestId('s3-add-key-access-key-id-input'), {
      target: { value: 'device-a' },
    })
    await fireEvent.input(
      view.getByTestId('s3-add-key-secret-access-key-input'),
      { target: { value: SPARE_SECRET } },
    )
    await fireEvent.click(view.getByTestId('s3-add-key-save'))
    expect(
      view.getByTestId('s3-add-key-access-key-id-error').textContent?.trim(),
    ).toBe(I18N_KEYS.ErrorsValidationS3AccessKeyIdDuplicate)
    expect(fixture.saved).toHaveLength(0)
  })

  test('remove drops only that spare key; the key in use has no remove control', async () => {
    const base = KeysFixture.s3()
    const stored = base.connection(base.row)
    const withSpares: StorageProvider = {
      ...base.row,
      provider: {
        ...stored,
        type: 's3',
        spareKeys: [
          { accessKeyId: 'device-b', secretAccessKey: SPARE_SECRET },
          { accessKeyId: 'device-c', secretAccessKey: 'TEST-ONLY-device-c' },
        ],
      },
    }
    const fixture = new KeysFixture(withSpares)
    const view = fixture.render()
    expect(view.getAllByTestId('s3-key-row')).toHaveLength(3)
    expect(view.queryAllByTestId('s3-remove-key-device-a')).toHaveLength(0)

    await fireEvent.click(view.getByTestId('s3-remove-key-device-b'))

    await waitFor(() => expect(fixture.saved).toHaveLength(1))
    const [savedRow] = fixture.saved
    if (!savedRow) throw new Error('the row is saved')
    expect(
      fixture.connection(savedRow).spareKeys.map((spare) => spare.accessKeyId),
    ).toEqual(['device-c'])
  })

  test('the invite page opens the Add key form of its provider once', () => {
    const fixture = KeysFixture.s3()
    const asked: S3KeyFormRequest = S3KeyFormRequests.open('s3-row')
    fixture.vault.s3KeyFormRequest = asked
    const view = fixture.render()
    expect(view.getAllByTestId('s3-add-key-form')).toHaveLength(1)
    expect(fixture.vault.s3KeyFormRequest).toEqual(S3KeyFormRequests.CLOSED)
  })
})
