import type { UntrustedYamlNode } from '../lib/guards.ts';

/** True when a YAML/JSON parser produced a Null object. */
export function isExternalNull(value: UntrustedYamlNode): boolean {
  return Object.prototype.toString.call(value) === '[object Null]';
}
