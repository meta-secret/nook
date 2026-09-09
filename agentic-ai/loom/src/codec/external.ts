import type { UntrustedYamlNode } from '../lib/guards.ts';

/** True when a YAML/JSON parser produced a Null object. */
export class YamlNullBoundary {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static matches(value: UntrustedYamlNode): boolean {
    return new YamlNullBoundary(value).execute();
  }
  private execute(): boolean {
    const value = this.request;
    return Object.prototype.toString.call(value) === '[object Null]';
  }
}
