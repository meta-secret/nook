/** Value received from an untrusted browser message or serialized boundary. */
export type ExternalValue =
  | string
  | number
  | boolean
  | readonly ExternalValue[]
  | ExternalObject

/** Object-shaped external payload after the boundary verifies its shape. */
export interface ExternalObject {
  readonly [key: string]: ExternalValue
}
