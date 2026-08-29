import { describe, expect, test } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  selectedEnrollmentHints,
  supplementalEnrollmentHints,
} from '../../../../nook-web-extension/src/content/autofill/enrollment-action-presentation'

describe('Rust-selected enrollment presentation', () => {
  test('renders only the recovery action selected by Rust', () => {
    expect(
      selectedEnrollmentHints(AuthenticationWorkflowAction.SaveBackupCodes),
    ).toEqual({ qr: false, backupCodes: true })
  })

  test('does not duplicate a primary recovery action as a supplemental action', () => {
    expect(
      supplementalEnrollmentHints(
        AuthenticationWorkflowAction.SaveBackupCodes,
        { qr: true, backupCodes: true },
      ),
    ).toEqual({ qr: false, backupCodes: false })
  })
})
