import { afterEach, describe, expect, test } from 'vitest'
import { recoveryCopyObservation } from '../../../../nook-web-extension/src/lib/backup-code-candidates'
import { handleCompanionWasmMessage } from '../../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

type RecoveryRuntimeResponse =
  { ok: true; result: CompanionWasmSessionResponse } | { ok: false }

afterEach(() => {
  document.body.replaceChildren()
})

describe('backup-code presentation evidence', () => {
  test('omits secret-bearing DOM from initial transport and extracts the bounded excerpt only on request', async () => {
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
    const instructions: string[][] = []
    const excerpts: string[] = []
    let secretBearingTextReads = 0
    const browserRuntime = {
      id: 'recovery-copy-test',
      sendMessage: (
        message: CompanionWasmRuntimeMessage,
        callback: (response: RecoveryRuntimeResponse) => void,
      ) => {
        if (
          message.type ===
          CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence
        )
          instructions.push(message.payload.texts)
        if (
          message.type ===
          CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates
        )
          excerpts.push(message.payload.text)
        void handleCompanionWasmMessage(message).then((result) =>
          result.match(
            (value) => callback({ ok: true, result: value }),
            () => callback({ ok: false }),
          ),
        )
      },
    }
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: browserRuntime },
    })
    document.body.innerHTML = `
      <h1>Save your recovery codes</h1>
      <p>Keep these recovery codes somewhere secure.</p>
      <ul><li>A1B2-C3D4-E5F6</li><li><p>G7H8-I9J0-K1L2</p></li></ul>
      <code>M3N4-O5P6-Q7R8</code>
      <pre>S9T0-U1V2-W3X4</pre>
      <p>Mixed instruction <code>Y5Z6-A7B8-C9D0</code></p>
      <p>Save your recovery codes: E1F2-G3H4-I5J6</p>
      <label>Copy <input value="E1F2-G3H4-I5J6"></label>
      <h2 id="mixed-secret-heading">Instruction <code>K7L8-M9N0-O1P2</code></h2>
      <ul><li><h2 id="nested-secret-heading">Q3R4-S5T6-U7V8</h2></li></ul>
    `
    for (const heading of document.querySelectorAll(
      '#mixed-secret-heading, #nested-secret-heading',
    )) {
      const copy = heading.textContent
      Object.defineProperty(heading, 'textContent', {
        configurable: true,
        get: () => {
          secretBearingTextReads += 1
          return copy
        },
      })
    }
    try {
      await recoveryCopyObservation.prepareAuthenticationRecoveryEvidence()
      expect(instructions).toEqual([['Save your recovery codes']])
      expect(excerpts).toHaveLength(0)
      expect(secretBearingTextReads).toBe(0)
      const candidates =
        await recoveryCopyObservation.extractDocumentBackupCodeCandidates()
      expect(excerpts).toHaveLength(1)
      expect(excerpts[0]).toContain('A1B2-C3D4-E5F6')
      expect(candidates).toContain('A1B2-C3D4-E5F6')
      expect(secretBearingTextReads).toBeGreaterThan(0)
      recoveryCopyObservation.clearBackupCodeCandidates(candidates)
      expect(candidates.every((candidate) => candidate === '')).toBe(true)
      const rejectRequest: typeof browserRuntime.sendMessage = (
        _message,
        callback,
      ) => callback({ ok: false })
      browserRuntime.sendMessage = rejectRequest
      await expect(
        recoveryCopyObservation.prepareAuthenticationRecoveryEvidence(),
      ).rejects.toThrow('Recovery instruction observation runtime unavailable.')
    } finally {
      if (previousChrome)
        Object.defineProperty(globalThis, 'chrome', previousChrome)
      else Reflect.deleteProperty(globalThis, 'chrome')
    }
  })

  test('keeps recovery secrets out of pre-consent classifier input', () => {
    document.body.innerHTML = `
      <h1>Save your recovery codes</h1>
      <ul><li>A1B2-C3D4-E5F6</li></ul>
    `

    expect(recoveryCopyObservation.authenticationRecoveryCopy()).toBe(
      'Save your recovery codes',
    )
    expect(recoveryCopyObservation.authenticationRecoveryCopy()).not.toContain(
      'A1B2-C3D4-E5F6',
    )
    expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('drops mixed instructional copy that contains an inline secret', () => {
    document.body.innerHTML = `
      <p>Save your recovery codes: A1B2-C3D4-E5F6</p>
      <h1>Save your backup codes</h1>
    `

    expect(recoveryCopyObservation.authenticationRecoveryCopy()).toBe(
      'Save your backup codes',
    )
    expect(recoveryCopyObservation.authenticationRecoveryCopy()).not.toContain(
      'A1B2-C3D4-E5F6',
    )
    expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('keeps digit-format instruction roles without mixing separate elements', () => {
    document.body.innerHTML = `
      <h1>Save your 8-digit backup codes somewhere secure.</h1>
      <p>Enter one of your backup codes</p>
      <p>Save this device</p>
    `

    expect(recoveryCopyObservation.authenticationRecoveryCopy()).toBe(
      'Save your 8-digit backup codes somewhere secure.',
    )
    expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('uses visible instruction roles but excludes paragraphs, hidden and code-bearing copy', () => {
    document.body.innerHTML = `
      <h1>Save your backup codes</h1>
      <p>Save these recovery codes somewhere secure.</p>
      <h2 hidden>Save your hidden backup codes</h2>
      <div aria-hidden="true"><h2>Save your inactive backup codes</h2></div>
      <button>Copy A1B2-C3D4-E5F6</button>
    `

    expect(recoveryCopyObservation.authenticationRecoveryCopy()).toBe(
      'Save your backup codes',
    )
    expect(recoveryCopyObservation.authenticationRecoveryCopy()).not.toContain(
      'hidden',
    )
    expect(recoveryCopyObservation.authenticationRecoveryCopy()).not.toContain(
      'inactive',
    )
    expect(recoveryCopyObservation.authenticationRecoveryCopy()).not.toContain(
      'A1B2-C3D4-E5F6',
    )
    expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('rejects backup-code login and ordinary OTP copy', () => {
    for (const heading of [
      'Use a backup code instead',
      'Authenticator code',
      'One-time code',
    ]) {
      document.body.innerHTML = `<h1>${heading}</h1>`
      expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(
        false,
      )
    }
  })

  test('prioritizes recovery evidence after long unrelated copy', () => {
    document.body.innerHTML = `
      <h1>${'Unrelated account details '.repeat(8)}</h1>
      <h2>Save these recovery codes somewhere secure.</h2>
    `

    expect(recoveryCopyObservation.authenticationRecoveryCopy()).toContain(
      'Save these recovery codes',
    )
    expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(true)
  })
})
