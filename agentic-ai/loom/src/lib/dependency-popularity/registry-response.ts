import { err, ok, type Result } from 'neverthrow';
import { UntrustedYamlBoundary, type UntrustedYamlNode } from '../guards.ts';

export enum RegistryFailureKind {
  Transport = 'transport',
  Json = 'json',
  Payload = 'payload',
}
export type RegistryFailure = {
  readonly kind: RegistryFailureKind;
  readonly message: string;
};
export type RegistryResponseRequest = {
  readonly url: string;
  readonly init?: RequestInit;
};

/** Owns the foreign HTTP and JSON exception boundaries for registry metrics. */
export class RegistryResponse {
  constructor(private readonly request: RegistryResponseRequest) {}

  async fetch(): Promise<Result<Response, RegistryFailure>> {
    const { url, init } = this.request;
    try {
      return ok(await fetch(url, init));
    } catch {
      return err({
        kind: RegistryFailureKind.Transport,
        message: `Registry request failed: ${url}`,
      });
    }
  }
}

export class RegistryJson {
  constructor(private readonly response: Response) {}

  async decode(): Promise<Result<UntrustedYamlNode, RegistryFailure>> {
    try {
      return ok(UntrustedYamlBoundary.fromHost(await this.response.json()));
    } catch {
      return err({
        kind: RegistryFailureKind.Json,
        message: `Registry JSON response invalid: ${this.response.url}`,
      });
    }
  }
}
