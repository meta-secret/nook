import { Effect, Result } from 'effect'
import { describe, expect, test } from 'vitest'
import { NookVaultManager } from '$app-wasm'
import {
  NookPageInputFieldObservation,
  PageInputType,
  classify_companion_focused_credential_field,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'

class ManagerCredentialSelection {
  constructor(
    private readonly metadata: {
      autocomplete: string
      inputType: PageInputType
    },
  ) {}
  selection() {
    const field = new NookPageInputFieldObservation(
      this.metadata.inputType,
      false,
      false,
      [this.metadata.autocomplete],
      '',
      false,
    )
    const recognition = classify_companion_focused_credential_field(field)
    try {
      return recognition.credential_selection()
    } finally {
      recognition.free()
      field.free()
    }
  }
}
const fields: { autocomplete: string; inputType: PageInputType }[] = [
  { autocomplete: 'username', inputType: PageInputType.Email },
  { autocomplete: 'current-password', inputType: PageInputType.Password },
]

describe('focused login manager generated JS boundary', () => {
  test.each(fields)(
    'accepts canonical %s request shape and exposes a JS Error on a closed vault',
    (metadata) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const manager = new NookVaultManager()
          const request: Parameters<
            NookVaultManager['reveal_website_login_for_focused_fill']
          >[0] = {
            secret_id: '00000000-0000-0000-0000-000000000001',
            origin: 'https://example.com',
            credential: new ManagerCredentialSelection(metadata).selection()
              .credential,
          }
          const outcome = yield* Effect.result(
            Effect.tryPromise(() =>
              manager.reveal_website_login_for_focused_fill(request),
            ),
          ).pipe(Effect.ensuring(Effect.sync(() => manager.free())))
          expect(Result.isFailure(outcome)).toBe(true)
          switch (outcome._tag) {
            case 'Failure':
              expect(outcome.failure.cause).toBeInstanceOf(Error)
              expect(String(outcome.failure.cause)).not.toContain(
                'Invalid focused login fill request',
              )
              break
            case 'Success':
              outcome.success.free()
              throw new Error('A closed vault must not release a credential')
          }
        }),
      ),
  )
})
