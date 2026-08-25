import { describe, expect, test } from 'bun:test'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
} from '../src/content/autofill/authentication-observation'

describe('authentication workflow observation', () => {
  test('rescans when a custom role button becomes focusable', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('tabindex')
  })

  test('rescans when a form action gains or loses login context', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('action')
  })

  test('rescans when an authentication dialog opens or closes', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('open')
  })

  test('rescans when an authentication field gains or loses readonly', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('readonly')
  })

  test('rescans when field identity evidence changes', () => {
    for (const attribute of ['placeholder', 'data-qa', 'data-testid', 'for']) {
      expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(attribute)
    }
  })

  test('rescans when a manual checkpoint marker changes', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(
      'data-nook-manual-checkpoint',
    )
  })

  test('rescans when responsive CSS can change control visibility', () => {
    expect(AUTHENTICATION_VIEWPORT_EVENTS).toContain('resize')
  })
})
