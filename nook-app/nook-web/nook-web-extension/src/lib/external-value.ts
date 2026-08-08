/** Value received from an untrusted browser, DOM, or serialized boundary. */
export type ExternalValue = string | number | boolean | bigint | symbol | object

/** Object-shaped external payload after the boundary verifies its shape. */
export type ExternalObject = Record<string, ExternalValue>
