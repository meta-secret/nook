/** Value received from an untrusted browser message or serialized boundary. */
export type ExternalValue =
  string | number | boolean | readonly ExternalValue[] | ExternalObject

/** Runtime input that may contain an external value and still needs validation. */
export type ExternalValueCandidate = object | string | number | boolean

/** Object-shaped external payload after the boundary verifies its shape. */
export interface ExternalObject {
  readonly [key: string]: ExternalValue
}

export function isExternalValue(
  value: ExternalValueCandidate,
): value is ExternalValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.every(isExternalValue)
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false
  }
  return Object.values(value).every(isExternalValue)
}
