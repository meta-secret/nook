import { describe, expect, test } from 'vitest'

import { plan_companion_credential_fill } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

describe('companion credential-fill WASM ABI', () => {
  test('accepts generated string contracts and returns typed assignments', () => {
    expect(
      plan_companion_credential_fill([
        { fieldIndex: 4, role: 'username', editability: 'writable' },
        { fieldIndex: 7, role: 'generic-password', editability: 'writable' },
      ]),
    ).toEqual({
      assignments: [
        { fieldIndex: 4, credential: 'username' },
        { fieldIndex: 7, credential: 'current-password' },
      ],
    })
  })

  test('fails closed for unsafe and malformed field roles', () => {
    expect(() =>
      plan_companion_credential_fill([
        { fieldIndex: 0, role: 'username', editability: 'writable' },
        { fieldIndex: 1, role: 'new-password', editability: 'writable' },
      ]),
    ).toThrow('the observed scope contains a new-password field')

    expect(() =>
      plan_companion_credential_fill([
        {
          fieldIndex: 2,
          // @ts-expect-error exercise the runtime boundary used by raw JavaScript callers
          role: 'password',
          editability: 'writable',
        },
      ]),
    ).toThrow()
  })
})
