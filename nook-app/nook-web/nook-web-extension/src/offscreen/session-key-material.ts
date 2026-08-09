export function toNumbers(value: Uint8Array): number[] {
  return Array.from(value)
}

export function toBytes(value: unknown): Uint8Array {
  if (!Array.isArray(value) || !value.every((byte) => Number.isInteger(byte))) {
    throw new Error('Extension session received invalid key material.')
  }
  return new Uint8Array(value)
}
