import { describe, it, expect } from 'vitest'
import { mapWasmRecords } from './nook'
import type { NookSecretRecord } from './nook-wasm/nook_wasm'

describe('nook helpers', () => {
  it('maps wasm records correctly', () => {
    const raw = [{ key: 'foo', value: 'bar' } as unknown as NookSecretRecord]
    const mapped = mapWasmRecords(raw)
    expect(mapped).toEqual([{ key: 'foo', value: 'bar' }])
  })
})
