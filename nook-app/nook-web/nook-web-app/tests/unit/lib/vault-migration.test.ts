import { beforeAll, describe, expect, it } from 'vitest'
import initNookWasm, { normalizeAuthSnapshot } from '$lib/nook-wasm/nook_wasm'

describe('normalizeAuthSnapshot', () => {
  beforeAll(async () => {
    await initNookWasm()
  })

  it('handles missing IndexedDB value without throwing', () => {
    const result = normalizeAuthSnapshot(undefined)
    expect(result.snapshot).toEqual({ providers: [] })
    expect(result.legacyActiveProviderId).toBeUndefined()
    expect(result.changed).toBe(false)
  })

  it('strips legacy activeProviderId from persisted snapshots', () => {
    const result = normalizeAuthSnapshot({
      providers: [{ id: 'a', type: 'github', label: 'GitHub', createdAt: '' }],
      activeProviderId: 'a',
    })
    expect(result.snapshot).toEqual({
      providers: [{ id: 'a', type: 'github', label: 'GitHub', createdAt: '' }],
    })
    expect(result.legacyActiveProviderId).toBe('a')
    expect(result.changed).toBe(true)
  })
})
