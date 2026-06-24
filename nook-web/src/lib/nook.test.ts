import { describe, expect, test } from 'vitest'
import { createVaultItemRecord, parseVaultItem } from './nook'
import { parse as parseYaml } from 'yaml'

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
      {
        type: 'secure-note' as const,
        title: 'Recovery steps',
        note: '# Steps\n\n1. First\n2. Second',
      },
    ]

    for (const input of inputs) {
      const record = createVaultItemRecord(input)
      expect(parseVaultItem(record)).toMatchObject(input)
      expect(record.type).toBe(input.type)
      expect(parseYaml(record.data)).not.toHaveProperty('type')
    }
  })
})
