import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import type { NookImportResult } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import LastPassImportPanel from '$lib/components/LastPassImportPanel.svelte'
import ProtonPassImportPanel from '$lib/components/ProtonPassImportPanel.svelte'
import GoogleAuthenticatorImportPanel from '$lib/components/GoogleAuthenticatorImportPanel.svelte'

const scanImage = vi.hoisted(() => vi.fn())

vi.mock('qr-scanner', () => ({
  default: class MockQrScanner {
    static scanImage = scanImage

    start = vi.fn(async () => undefined)
    stop = vi.fn()
    destroy = vi.fn()
  },
}))

const vault = {
  t(key: string, values?: Record<string, string>): string {
    return values ? `${key} ${Object.values(values).join(' ')}` : key
  },
} as unknown as VaultState

function importResult(): NookImportResult {
  return {
    imported: 2,
    skippedUnsupported: 1,
    skippedDuplicates: 3,
  } as NookImportResult
}

describe('LastPass import panel', () => {
  test('shows progress and locks the file input until import finishes', async () => {
    let finishImport: ((result: NookImportResult) => void) | undefined =
      undefined
    const onImport = vi.fn(
      async () =>
        new Promise<NookImportResult>((resolve) => {
          finishImport = resolve
        }),
    )
    const view = render(LastPassImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = view.getByTestId('lastpass-csv-file') as HTMLInputElement
    const submit = view.getByTestId(
      'lastpass-import-submit',
    ) as HTMLButtonElement
    await fireEvent.change(input, {
      target: {
        files: [new File(['url,username,password\n'], 'lastpass.csv')],
      },
    })

    await fireEvent.click(submit)
    await waitFor(() => {
      expect(
        view.getByTestId('lastpass-import-panel-progress'),
      ).toHaveTextContent('common.import_progress_title')
    })
    expect(input.disabled).toBe(true)
    expect(submit.disabled).toBe(true)

    finishImport?.(importResult())
    await waitFor(() => {
      expect(
        view.queryByTestId('lastpass-import-panel-progress'),
      ).not.toBeInTheDocument()
    })
  })

  test('enables submission after file selection and renders the result', async () => {
    const onImport = vi.fn(async () => importResult())
    const view = render(LastPassImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = view.getByTestId('lastpass-csv-file') as HTMLInputElement
    const submit = view.getByTestId(
      'lastpass-import-submit',
    ) as HTMLButtonElement

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
      throw new Error('invalid LastPass CSV')
    })
    const view = render(LastPassImportPanel, {
      vault,
      isSaving: true,
      onImport,
    })
    const input = view.getByTestId('lastpass-csv-file') as HTMLInputElement
    const submit = view.getByTestId(
      'lastpass-import-submit',
    ) as HTMLButtonElement
    await fireEvent.change(input, {
      target: { files: [new File(['invalid'], 'lastpass.csv')] },
    })
    expect(submit.disabled).toBe(true)

    await view.rerender({ vault, isSaving: false, onImport })
    await fireEvent.click(submit)
    await waitFor(() => {
      expect(view.getByTestId('lastpass-import-error').textContent).toContain(
        'invalid LastPass CSV',
      )
    })
  })
})

describe('Proton Pass import panel', () => {
  test('reads selected export bytes and renders the result', async () => {
    let receivedBytes: number[] = []
    const onImport = vi.fn(async (bytes: Uint8Array) => {
      receivedBytes = Array.from(bytes)
      return importResult()
    })
    const view = render(ProtonPassImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = view.getByTestId(
      'proton-pass-export-file',
    ) as HTMLInputElement
    const submit = view.getByTestId(
      'proton-pass-import-submit',
    ) as HTMLButtonElement

    expect(submit.disabled).toBe(true)
    await fireEvent.change(input, {
      target: {
        files: [new File([new Uint8Array([80, 75, 3, 4])], 'proton.zip')],
      },
    })
    expect(submit.disabled).toBe(false)

    await fireEvent.click(submit)
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(receivedBytes).toEqual([80, 75, 3, 4])
    await waitFor(() => {
      expect(
        view.getByTestId('proton-pass-import-result').textContent,
      ).toContain('proton_pass_import.result_imported 2')
    })
  })

  test('renders import errors', async () => {
    const onImport = vi.fn(async () => {
      throw new Error('encrypted Proton export')
    })
    const view = render(ProtonPassImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = view.getByTestId(
      'proton-pass-export-file',
    ) as HTMLInputElement
    await fireEvent.change(input, {
      target: { files: [new File(['encrypted'], 'proton.zip')] },
    })
    await fireEvent.click(view.getByTestId('proton-pass-import-submit'))

    await waitFor(() => {
      expect(
        view.getByTestId('proton-pass-import-error').textContent,
      ).toContain('encrypted Proton export')
    })
  })
})

describe('Google Authenticator import panel', () => {
  test('collects QR images and submits the migration batch without displaying its contents', async () => {
    const firstUri = 'otpauth-migration://offline?data=first-secret-payload'
    const secondUri = 'otpauth-migration://offline?data=second-secret-payload'
    scanImage
      .mockResolvedValueOnce({ data: firstUri, cornerPoints: [] })
      .mockResolvedValueOnce({ data: secondUri, cornerPoints: [] })
    const onImport = vi.fn(async () => importResult())
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport,
    })
    const input = view.getByTestId(
      'google-authenticator-qr-image',
    ) as HTMLInputElement
    const submit = view.getByTestId(
      'google-authenticator-import-submit',
    ) as HTMLButtonElement

    expect(submit.disabled).toBe(true)
    await fireEvent.change(input, {
      target: { files: [new File(['first'], 'first.png')] },
    })
    await waitFor(() => expect(scanImage).toHaveBeenCalledTimes(1))
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

  test('rejects duplicate and unrelated QR codes before import', async () => {
    const migrationUri = 'otpauth-migration://offline?data=secret-payload'
    scanImage
      .mockResolvedValueOnce({ data: migrationUri, cornerPoints: [] })
      .mockResolvedValueOnce({ data: migrationUri, cornerPoints: [] })
      .mockResolvedValueOnce({ data: 'https://example.com', cornerPoints: [] })
    const view = render(GoogleAuthenticatorImportPanel, {
      vault,
      isSaving: false,
      onImport: vi.fn(async () => importResult()),
    })
    const input = view.getByTestId(
      'google-authenticator-qr-image',
    ) as HTMLInputElement

    for (const name of ['first.png', 'duplicate.png']) {
      await fireEvent.change(input, {
        target: { files: [new File([name], name)] },
      })
    }
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-import-error').textContent,
      ).toContain('google_authenticator_import.duplicate_qr')
    })
    await fireEvent.change(input, {
      target: { files: [new File(['other'], 'other.png')] },
    })
    await waitFor(() => {
      expect(
        view.getByTestId('google-authenticator-import-error').textContent,
      ).toContain('google_authenticator_import.invalid_qr')
    })
  })
})
