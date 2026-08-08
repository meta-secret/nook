/** True when a YAML/JSON parser produced a Null object. */
export function isExternalNull(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object Null]';
}
