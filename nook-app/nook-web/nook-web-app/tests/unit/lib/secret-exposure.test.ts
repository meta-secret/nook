import { describe, expect, test, vi } from 'vitest'
import type { NookSecretRecord } from '$lib/nook'
import { SecretExposure } from '$lib/vault/secret-exposure'

function fakeRecord(value: string) {
  return {
    primaryCredential: value,
    free: vi.fn(),
  } as unknown as NookSecretRecord
}

describe('secret exposure lifecycle', () => {
  test('does not decrypt until reveal is requested', async () => {
    const load = vi.fn(async () => fakeRecord('credential'))
    expect(load).not.toHaveBeenCalled()

    const records = await new SecretExposure({}).toggle({
      id: 'secret-1',
      load: load,
    })

    expect(load).toHaveBeenCalledOnce()
    expect(records['secret-1']?.primaryCredential).toBe('credential')
  })

  test('hiding a revealed secret frees and removes plaintext', async () => {
    const record = fakeRecord('credential')
    const records = await new SecretExposure({ 'secret-1': record }).toggle({
      id: 'secret-1',
      load: vi.fn(),
    })

    expect(record.free).toHaveBeenCalledOnce()
    expect(Object.hasOwn(records, 'secret-1')).toBe(false)
  })

  test('copy decrypts a hidden record for one action then frees it', async () => {
    const record = fakeRecord('credential')
    const copied = vi.fn()

    await new SecretExposure({}).withRecord({
      id: 'secret-1',
      load: async () => record,
      action: (secret) => copied(secret.primaryCredential),
    })

    expect(copied).toHaveBeenCalledWith('credential')
    expect(record.free).toHaveBeenCalledOnce()
  })

  test('copy reuses an already revealed record without freeing it', async () => {
    const record = fakeRecord('credential')
    const load = vi.fn()

    await new SecretExposure({ 'secret-1': record }).withRecord({
      id: 'secret-1',
      load: load,
      action: () => {},
    })

    expect(load).not.toHaveBeenCalled()
    expect(record.free).not.toHaveBeenCalled()
  })

  test('failed hidden-record actions still free plaintext', async () => {
    const record = fakeRecord('credential')

    await expect(
      new SecretExposure({}).withRecord({
        id: 'secret-1',
        load: async () => record,
        action: () => {
          throw new Error('clipboard denied')
        },
      }),
    ).rejects.toThrow('clipboard denied')
    expect(record.free).toHaveBeenCalledOnce()
  })

  test('page replacement frees every revealed record', () => {
    const first = fakeRecord('first')
    const second = fakeRecord('second')

    new SecretExposure({ first, second }).free()

    expect(first.free).toHaveBeenCalledOnce()
    expect(second.free).toHaveBeenCalledOnce()
  })
})
