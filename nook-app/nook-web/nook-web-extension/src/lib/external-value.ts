/** Value received from an untrusted browser message or serialized boundary. */
export type ExternalValue =
  | string
  | number
  | boolean
  | ExternalValue[]
  | ExternalObject

/** Object-shaped external payload after the boundary verifies its shape. */
export type ExternalObject = Record<string, ExternalValue>
