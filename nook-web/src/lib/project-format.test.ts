import { describe, expect, it } from 'vitest'
import { getProjectInitials } from './project-format'

describe('getProjectInitials', () => {
  it('creates compact labels for workspace packages', () => {
    expect(getProjectInitials('nook-core')).toBe('NC')
    expect(getProjectInitials('nook-wasm')).toBe('NW')
    expect(getProjectInitials('nook-web')).toBe('NW')
  })
})
