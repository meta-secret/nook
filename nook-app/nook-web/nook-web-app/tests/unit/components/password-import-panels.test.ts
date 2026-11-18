import { ok, err } from 'neverthrow'
import { Effect } from 'effect'
import type { QrCodeReader } from '$lib/qr/qr-code-reader'
import type { SecretOperationResult } from '$lib/vault/secret-operation-failure'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { NookImportResult } from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { requireButtonElement, requireInputElement } from '../test-dom-helpers'
import PasswordManagerImportPanel from '$lib/components/PasswordManagerImportPanel.svelte'
import { PASSWORD_IMPORT_PRESETS } from '$lib/components/password-manager-import-presets'
import GoogleAuthenticatorImportPanel from '$lib/components/GoogleAuthenticatorImportPanel.svelte'
import type { TranslationRequest } from '$lib/vault/translation'
import { TranslationMessage } from '$lib/vault/translation'

const qrReads = vi.hoisted(() => ({
  image: vi.fn<QrCodeReader['readImage']>(),
  frame: vi.fn<QrCodeReader['readVideoFrame']>(),
}))

vi.mock('$lib/qr/qr-code-reader', () => ({
  QrCodeReader: class MockQrCodeReader {
    readImage = qrReads.image
    readVideoFrame = qrReads.frame
  },
}))

/** A camera stream whose one video track the panel must stop. */
class CameraStreamFixture extends MediaStream {
  constructor() {
    super(document.createElement('canvas').captureStream().getVideoTracks())
  }

  override getTracks(): MediaStreamTrack[] {
    return this.getVideoTracks()
  }
}

/** Installs `navigator.mediaDevices` for one test. */
class CameraFixture {
  readonly stream = new CameraStreamFixture()
  readonly getUserMedia = vi.fn(async () => this.stream)

  install(): void {
    const mediaDevices: PropertyDescriptor = {
      configurable: true,
      value: { getUserMedia: this.getUserMedia },
    }
    Object.defineProperty(navigator, 'mediaDevices', mediaDevices)
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    })
  }
}

const vault = VaultStateTestFixture.create()
vi.spyOn(vault, 't').mockImplementation((request: TranslationRequest) => {
  const message = new TranslationMessage(request)
  const replacements = message.translationReplacements()
  const values = Object.values(replacements)
  const key = message.translationKey()
  return values.length > 0 ? `${key} ${values.join(' ')}` : key
})

function importResult(): SecretOperationResult<NookImportResult> {
  const result = {
    imported: 2,
    skippedUnsupported: 1,
    skippedDuplicates: 3,
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  } satisfies NookImportResult
  return ok(result)
}

describe('CSV password import panels', () => {
  test.each([
    {
      preset: PASSWORD_IMPORT_PRESETS.KeePassXc,
      id: 'keepassxc',
      fileTestId: 'keepassxc-csv-file',
      resultKey: I18N_KEYS.KeepassxcImportResultImported,
      accept: '.csv,text/csv,application/csv',
    },
    {
      preset: PASSWORD_IMPORT_PRESETS.Keeper,
      id: 'keeper',
      fileTestId: 'keeper-csv-file',
      resultKey: I18N_KEYS.KeeperImportResultImported,
      accept: '.csv,text/csv,application/csv',
    },
    {
      preset: PASSWORD_IMPORT_PRESETS.ChromePasswords,
      id: 'chrome-passwords',
      fileTestId: 'chrome-passwords-csv-file',
      resultKey: I18N_KEYS.ChromePasswordsImportResultImported,
      accept: '.csv,text/csv',
    },
  ])(
    '$id submits the selected text and renders the result',
    async ({ preset, id, fileTestId, resultKey, accept }) => {
      const onImport = vi.fn(async () => importResult())
      const view = render(PasswordManagerImportPanel, {
        ...preset,
        vault,
        isSaving: false,
        onImport,
      })
      const input = requireInputElement(view.getByTestId(fileTestId))
      const submit = requireButtonElement(
        view.getByTestId(`${id}-import-submit`),
      )

      expect(input.accept).toBe(accept)
      expect(submit.disabled).toBe(true)
      await fireEvent.change(input, {
        target: {
          files: [
            new File(
              ['Group,Title,Username,Password,URL,Notes\n'],
              `${id}.csv`,
            ),
          ],
        },
      })
      expect(submit.disabled).toBe(false)

      await fireEvent.click(submit)
      await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
      expect(onImport).toHaveBeenCalledWith(
        'Group,Title,Username,Password,URL,Notes\n',
      )
      await waitFor(() => {
        expect(view.getByTestId(`${id}-import-result`).textContent).toContain(
          `${resultKey} 2`,
        )
      })
    },
  )
})

describe('LastPass import panel', () => {
  test('shows progress and locks the file input until import finishes', async () => {
    let finishImport: (
      result: SecretOperationResult<NookImportResult>,
    ) => void = () => {}
    const onImport = vi.fn(
      async () =>
        new Promise<SecretOperationResult<NookImportResult>>((resolve) => {
          finishImport = resolve
        }),
    )
    const view = render(PasswordManagerImportPanel, {
      ...PASSWORD_IMPORT_PRESETS.LastPass,
      vault,
      isSaving: false,
      onImport,
    })
    const input = requireInputElement(view.getByTestId('lastpass-csv-file'))
    const submit = requireButtonElement(
      view.getByTestId('lastpass-import-submit'),
    )
    await fireEvent.change(input, {
      target: {
        files: [new File(['url,username,password\n'], 'lastpass.csv')],
      },
    })

    await fireEvent.click(submit)
    await waitFor(() => {
      expect(
        view.getByTestId('lastpass-import-panel-progress').textContent,
      ).toContain(I18N_KEYS.CommonImportProgressTitle)
    })
    expect(input.disabled).toBe(true)
    expect(submit.disabled).toBe(true)

    finishImport(importResult())
    await waitFor(() => {
      expect(
        view.queryAllByTestId('lastpass-import-panel-progress'),
      ).toHaveLength(0)
    })
  })

  test('enables submission after file selection and renders the result', async () => {
    const onImport = vi.fn(async () => importResult())
    const view = render(PasswordManagerImportPanel, {
      ...PASSWORD_IMPORT_PRESETS.LastPass,
      vault,
      isSaving: false,
      onImport,
    })
    const input = requireInputElement(view.getByTestId('lastpass-csv-file'))
    const submit = requireButtonElement(
      view.getByTestId('lastpass-import-submit'),
    )

    expect(submit.disabled).toBe(true)
    await fireEvent.change(input, {
      target: {
        files: [new File(['url,username,password\n'], 'lastpass.csv')],
      },
    })
    expect(submit.disabled).toBe(false)

    await fireEvent.click(submit)
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport).toHaveBeenCalledWith('url,username,password\n')
    await waitFor(() => {
      expect(view.getByTestId('lastpass-import-result').textContent).toContain(
        'lastpass_import.result_imported 2',
      )
    })
  })

  test('renders import errors and keeps submission disabled while saving', async () => {
    const onImport = vi.fn(async () => {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })
    const view = render(PasswordManagerImportPanel, {
      ...PASSWORD_IMPORT_PRESETS.LastPass,
      vault,
      isSaving: true,
      onImport,
    })
    const input = requireInputElement(view.getByTestId('lastpass-csv-file'))
    const submit = requireButtonElement(
      view.getByTestId('lastpass-import-submit'),
    )
    await fireEvent.change(input, {
      target: { files: [new File(['invalid'], 'lastpass.csv')] },
    })
    expect(submit.disabled).toBe(true)

    await view.rerender({ vault, isSaving: false, onImport })
    await fireEvent.click(submit)
    await waitFor(() => {
      expect(view.getByTestId('lastpass-import-error').textContent).toContain(
        I18N_KEYS.AuthStorageSyncFailed,
      )
    })
  })

  test('renders a typed failure when text import rejects', async () => {
    const onImport = vi.fn(async () => {
      throw new Error('adapter rejected')
    })
    const view = render(PasswordManagerImportPanel, {
      ...PASSWORD_IMPORT_PRESETS.LastPass,
      vault,
      isSaving: false,
      onImport,
    })
    const input = requireInputElement(view.getByTestId('lastpass-csv-file'))
    await fireEvent.change(input, {
      target: { files: [new File(['invalid'], 'lastpass.csv')] },
    })
    await fireEvent.click(view.getByTestId('lastpass-import-submit'))

    await waitFor(() => {
      expect(view.getByTestId('lastpass-import-error').textContent).toContain(
        I18N_KEYS.AuthStorageSyncFailed,
      )
    })
  })
})

describe('binary password import panels', () => {
  test.each([
    {
      preset: PASSWORD_IMPORT_PRESETS.ApplePasswords,
      id: 'apple-passwords',
      fileTestId: 'apple-passwords-csv-file',
      resultKey: I18N_KEYS.ApplePasswordsImportResultImported,
      accept: '.csv,.zip,text/csv,application/zip,application/x-zip-compressed',
      filename: 'Safari.zip',
    },
    {
      preset: PASSWORD_IMPORT_PRESETS.Dashlane,
      id: 'dashlane',
      fileTestId: 'dashlane-export-file',
      resultKey: I18N_KEYS.DashlaneImportResultImported,
      accept: '.csv,.zip,text/csv,application/zip,application/x-zip-compressed',
      filename: 'dashlane.zip',
    },
    {
      preset: PASSWORD_IMPORT_PRESETS.ProtonPass,
      id: 'proton-pass',
      fileTestId: 'proton-pass-export-file',
      resultKey: I18N_KEYS.ProtonPassImportResultImported,
      accept:
        '.zip,.json,application/zip,application/x-zip-compressed,application/json',
      filename: 'proton.zip',
    },
    {
      preset: PASSWORD_IMPORT_PRESETS.OnePassword,
      id: 'onepassword',
      fileTestId: 'onepassword-pux-file',
      resultKey: I18N_KEYS.OnepasswordImportResultImported,
      accept: '.1pux,application/zip,application/x-zip-compressed',
      filename: 'export.1pux',
    },
  ])(
    '$id submits the selected bytes and renders the result',
    async ({ preset, id, fileTestId, resultKey, accept, filename }) => {
      let receivedBytes: number[] = []
      const onImport = vi.fn(async (bytes: Uint8Array) => {
        receivedBytes = Array.from(bytes)
        return importResult()
      })
      const view = render(PasswordManagerImportPanel, {
        ...preset,
        vault,
        isSaving: false,
        onImport,
      })
      const input = requireInputElement(view.getByTestId(fileTestId))
      const submit = requireButtonElement(
        view.getByTestId(`${id}-import-submit`),
      )

      expect(input.accept).toBe(accept)
      expect(submit.disabled).toBe(true)
      await fireEvent.change(input, {
        target: {
          files: [new File([new Uint8Array([80, 75, 3, 4])], filename)],
        },
      })
      expect(submit.disabled).toBe(false)

      await fireEvent.click(submit)
      await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
      expect(receivedBytes).toEqual([80, 75, 3, 4])
      await waitFor(() => {
        expect(view.getByTestId(`${id}-import-result`).textContent).toContain(
          `${resultKey} 2`,
        )
      })
    },
  )
})

describe('Proton Pass import panel', () => {
  test('renders import errors', async () => {
    const onImport = vi.fn(async () => {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })
    const view = render(PasswordManagerImportPanel, {
      ...PASSWORD_IMPORT_PRESETS.ProtonPass,
      vault,
      isSaving: false,
      onImport,
    })
    const input = requireInputElement(
      view.getByTestId('proton-pass-export-file'),
    )
    await fireEvent.change(input, {
      target: { files: [new File(['encrypted'], 'proton.zip')] },
    })
    await fireEvent.click(view.getByTestId('proton-pass-import-submit'))

    await waitFor(() => {
      expect(
        view.getByTestId('proton-pass-import-error').textContent,
      ).toContain(I18N_KEYS.AuthStorageSyncFailed)
    })
  })
})

describe('Google Authenticator import panel', () => {
  test('collects QR images and submits the migration batch without displaying its contents', async () => {
    const firstUri = 'otpauth-migration://offline?data=first-secret-payload'
    const secondUri = 'otpauth-migration://offline?data=second-secret-payload'
    qrReads.image
      .mockReturnValueOnce(Effect.succeed([firstUri]))
      .mockReturnValueOnce(Effect.succeed([secondUri]))
    const onImport = vi.fn(async () => importResult())
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = requireInputElement(
      view.getByTestId('google-authenticator-qr-image'),
    )
    const submit = requireButtonElement(
      view.getByTestId('google-authenticator-import-submit'),
    )

    expect(submit.disabled).toBe(true)
    await fireEvent.change(input, {
      target: { files: [new File(['first'], 'first.png')] },
    })
    await waitFor(() => expect(qrReads.image).toHaveBeenCalledTimes(1))
    await fireEvent.change(input, {
      target: { files: [new File(['second'], 'second.png')] },
    })
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-scanned-count').textContent,
      ).toContain('google_authenticator_import.scanned_count 2')
    })
    expect(view.container.textContent).not.toContain(firstUri)
    expect(view.container.textContent).not.toContain(secondUri)

    await fireEvent.click(submit)
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport).toHaveBeenCalledWith([firstUri, secondUri])
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-import-result').textContent,
      ).toContain('google_authenticator_import.result_imported 2')
    })
    expect(submit.disabled).toBe(true)
  })

  test('reads every QR image chosen at once and keeps an unreadable one visible', async () => {
    const firstUri = 'otpauth-migration://offline?data=first-of-many'
    const lastUri = 'otpauth-migration://offline?data=last-of-many'
    qrReads.image
      .mockReturnValueOnce(Effect.succeed([firstUri]))
      .mockReturnValueOnce(Effect.succeed([]))
      .mockReturnValueOnce(Effect.succeed([lastUri]))
    const onImport = vi.fn(async () => importResult())
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = requireInputElement(
      view.getByTestId('google-authenticator-qr-image'),
    )

    expect(input.multiple).toBe(true)
    await fireEvent.change(input, {
      target: {
        files: [
          new File(['1'], '1.jpg'),
          new File(['2'], '2.jpg'),
          new File(['3'], '3.jpg'),
        ],
      },
    })
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-scanned-count').textContent,
      ).toContain('google_authenticator_import.scanned_count 2')
      expect(
        view.getByTestId('google-authenticator-import-error').textContent,
      ).toContain(I18N_KEYS.GoogleAuthenticatorImportImageFailed)
    })

    await fireEvent.click(
      view.getByTestId('google-authenticator-import-submit'),
    )
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith([firstUri, lastUri]),
    )
  })

  test('rejects duplicate, unrelated, and unreadable QR images before import', async () => {
    const migrationUri = 'otpauth-migration://offline?data=secret-payload'
    qrReads.image
      .mockReturnValueOnce(Effect.succeed([migrationUri]))
      .mockReturnValueOnce(Effect.succeed([migrationUri]))
      .mockReturnValueOnce(Effect.succeed(['https://example.com']))
      .mockReturnValueOnce(Effect.succeed([]))
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport: vi.fn(async () => importResult()),
    })
    const input = requireInputElement(
      view.getByTestId('google-authenticator-qr-image'),
    )
    const upload = async (name: string) => {
      await fireEvent.change(input, {
        target: { files: [new File([name], name)] },
      })
    }
    const errorText = () =>
      view.getByTestId('google-authenticator-import-error').textContent

    await upload('first.png')
    await upload('duplicate.png')
    await waitFor(() => {
      expect(errorText()).toContain(
        I18N_KEYS.GoogleAuthenticatorImportDuplicateQr,
      )
    })
    await upload('other.png')
    await waitFor(() => {
      expect(errorText()).toContain(
        I18N_KEYS.GoogleAuthenticatorImportInvalidQr,
      )
    })
    await upload('blank.png')
    await waitFor(() => {
      expect(errorText()).toContain(
        I18N_KEYS.GoogleAuthenticatorImportImageFailed,
      )
    })
  })

  test('keeps the camera scanning and ignores codes it already collected', async () => {
    const firstUri = 'otpauth-migration://offline?data=first-batch'
    const secondUri = 'otpauth-migration://offline?data=second-batch'
    const camera = new CameraFixture()
    camera.install()
    qrReads.frame
      .mockReturnValueOnce(Effect.succeed([firstUri]))
      .mockReturnValueOnce(Effect.succeed([firstUri]))
      .mockReturnValueOnce(Effect.succeed([secondUri]))
      .mockReturnValue(Effect.succeed([]))
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport: vi.fn(async () => importResult()),
    })
    const toggle = view.getByTestId('google-authenticator-camera-toggle')

    await fireEvent.click(toggle)
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-scanned-count').textContent,
      ).toContain('google_authenticator_import.scanned_count 2')
    })
    expect(qrReads.frame.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(
      view.queryAllByTestId('google-authenticator-import-error'),
    ).toHaveLength(0)
    expect(toggle.textContent).toContain(
      I18N_KEYS.GoogleAuthenticatorImportStopCamera,
    )

    await fireEvent.click(toggle)
    const [track] = camera.stream.getVideoTracks()
    await waitFor(() => expect(track?.readyState).toBe('ended'))
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1)
    expect(toggle.textContent).toContain(
      I18N_KEYS.GoogleAuthenticatorImportScanCamera,
    )
  })

  test('reports a camera that cannot start', async () => {
    const camera = new CameraFixture()
    camera.getUserMedia.mockRejectedValueOnce(
      new DOMException('Permission denied', 'NotAllowedError'),
    )
    camera.install()
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport: vi.fn(async () => importResult()),
    })
    const toggle = view.getByTestId('google-authenticator-camera-toggle')

    await fireEvent.click(toggle)
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-import-error').textContent,
      ).toContain(I18N_KEYS.GoogleAuthenticatorImportCameraFailed)
    })
    expect(toggle.textContent).toContain(
      I18N_KEYS.GoogleAuthenticatorImportScanCamera,
    )
  })
})
