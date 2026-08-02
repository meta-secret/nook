import { describe, expect, test } from 'bun:test'
import { extensionDeviceProtectionStatus } from '../src/lib/nook-wasm'

describe('extensionDeviceProtectionStatus', () => {
  test('rejects an unrecognized status from the extension session', async () => {
    const responses: unknown[] = [
      { ok: true },
      { ok: true, status: 'future-protection-state' },
    ]
    globalThis.chrome = {
      runtime: {
        sendMessage: (_message, callback) => callback(responses.shift()),
      },
    } as typeof chrome

    await expect(extensionDeviceProtectionStatus()).rejects.toThrow(
      'Unsupported extension device protection status.',
    )
  })
})
