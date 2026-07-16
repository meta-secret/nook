import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import type { NookImportResult } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import LastPassImportPanel from '$lib/components/LastPassImportPanel.svelte'
import ProtonPassImportPanel from '$lib/components/ProtonPassImportPanel.svelte'

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
