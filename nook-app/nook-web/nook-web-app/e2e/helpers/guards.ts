export function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`)
  }
  return Object.fromEntries(Object.entries(value))
}

export function readStringProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const property = value[key]
  if (typeof property !== 'string') {
    throw new Error(`${label}.${key} was not a string.`)
  }
  return property
}
