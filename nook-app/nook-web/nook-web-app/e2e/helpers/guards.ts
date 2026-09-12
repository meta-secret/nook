/** Parse untrusted JSON without allowing its `any` result into the test code. */
export function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

export function requireValue<T>(value: T, label: string): NonNullable<T> {
  if (!value) {
    throw new Error(`${label} was not available.`)
  }
  return value as NonNullable<T>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    Object(value) === value &&
    !Array.isArray(value)
  )
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} was not an array.`)
  }
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`${label} contained a non-string value.`)
    }
    result.push(item)
  }
  return result
}

export function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} was not an object.`)
  }
  return { ...value }
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

export function requireMessageRecord(
  value: unknown,
  label: string,
): Record<string, { message: string }> {
  const record = requireRecord(value, label)
  const result: Record<string, { message: string }> = {}
  for (const [key, entry] of Object.entries(record)) {
    const messageRecord = requireRecord(entry, `${label}.${key}`)
    result[key] = {
      message: readStringProperty(messageRecord, 'message', `${label}.${key}`),
    }
  }
  return result
}
