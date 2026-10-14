import { describe, expect, test } from 'vitest'
import {
  CipherBlock,
  CipherStripText,
} from '../../../../nook-web-shared/src/vault-app/lib/components/ui/cipher/cipher-text'
import {
  StatusTone,
  StatusToneClass,
} from '../../../../nook-web-shared/src/vault-app/lib/components/ui/status-tag/status-tag-state'

const BASE64 = /^[A-Za-z0-9+/]*$/

describe('identity UI primitives', () => {
  test('status tones map to tag classes; neutral adds none', () => {
    expect(new StatusToneClass(StatusTone.Neutral).name).toBe('')
    expect(new StatusToneClass(StatusTone.Success).name).toBe('nk-tag-success')
    expect(new StatusToneClass(StatusTone.Warning).name).toBe('nk-tag-warning')
    expect(new StatusToneClass(StatusTone.Danger).name).toBe('nk-tag-danger')
  })

  test('cipher block keeps its armor header and only base64 body text', () => {
    const block = new CipherBlock({ rows: 6, columns: 40 })
    for (let tick = 0; tick < 25; tick += 1) block.tick(10)
    const lines = block.segments.map((line) =>
      line.map((segment) => segment.text).join(''),
    )
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe('-----BEGIN AGE ENCRYPTED FILE-----')
    for (const line of lines.slice(1)) {
      expect(line).toHaveLength(40)
      expect(line).toMatch(BASE64)
    }
    const hotRuns = block.segments.flat().filter((segment) => segment.hot)
    expect(hotRuns.length).toBeLessThanOrEqual(1)
  })

  test('cipher strip drifts without changing length or alphabet', () => {
    const strip = new CipherStripText(32)
    const before = strip.text
    for (let tick = 0; tick < 40; tick += 1) strip.tick(3)
    expect(strip.text).toHaveLength(32)
    expect(strip.text).toMatch(BASE64)
    expect(strip.text).not.toBe(before)
  })
})
