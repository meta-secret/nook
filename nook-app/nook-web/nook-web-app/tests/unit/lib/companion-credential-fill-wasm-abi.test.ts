import { describe, expect, test } from 'vitest'

import { plan_companion_credential_fill } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

describe('companion credential-fill WASM ABI', () => {
  test('preserves exact Rust source names across the generated contract', () => {
    expect(
      plan_companion_credential_fill([
        {
          field_index: { value: 4 },
          role: 'Username',
          editability: 'Writable',
        },
        {
          field_index: { value: 7 },
          role: 'GenericPassword',
          editability: 'Writable',
        },
      ]),
    ).toEqual({
      assignments: [
        { field_index: { value: 4 }, credential: 'Username' },
        { field_index: { value: 7 }, credential: 'CurrentPassword' },
      ],
    })
  })

  test('fails closed for unsafe and malformed field roles', () => {
    expect(() =>
      plan_companion_credential_fill([
        {
          field_index: { value: 0 },
          role: 'Username',
          editability: 'Writable',
        },
        {
          field_index: { value: 1 },
          role: 'NewPassword',
          editability: 'Writable',
        },
      ]),
    ).toThrow('the observed scope contains a new-password field')

    expect(() =>
      plan_companion_credential_fill([
        {
          field_index: { value: 2 },
          // @ts-expect-error exercise the runtime boundary used by raw JavaScript callers
          role: 'Password',
          editability: 'Writable',
        },
      ]),
    ).toThrow()
  })
})
