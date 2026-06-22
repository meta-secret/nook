import { describe, expect, test } from 'vitest'
import { createVaultItemRecord, parseVaultItem } from './nook'

describe('typed vault items', () => {
  test('round-trips each supported item type', () => {
    const inputs = [
      {
        type: 'login' as const,
        websiteUrl: 'https://example.com',
        username: 'alice',
        password: 'correct horse',
        notes: 'Personal account',
      },
      {
        type: 'api-key' as const,
        websiteUrl: 'https://api.example.com',
        key: 'token-123',
        expiresAt: '2030-01-01',
      },
      {
        type: 'seed-phrase' as const,
        name: 'Main wallet',
        seed: 'one two three four',
      },
    ]

    for (const input of inputs) {
      const record = createVaultItemRecord(input)
      expect(parseVaultItem(record)).toMatchObject(input)
      expect(record.key).toContain('item:')
    }
  })

  test('opens legacy label/value secrets as API keys', () => {
    expect(parseVaultItem({ key: 'github.com', value: 'ghp_legacy' })).toEqual({
      id: 'github.com',
      type: 'api-key',
      websiteUrl: 'github.com',
      key: 'ghp_legacy',
      expiresAt: '',
    })
  })
})
