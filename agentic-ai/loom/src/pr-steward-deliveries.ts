import { createHash } from 'node:crypto';

type PrStewardDeliveryRequest = { readonly data: Uint8Array };

// Only successfully emitted hints enter this bounded, process-local set.
export class PrStewardDeliveries {
  readonly #emitted = new Set<string>();

  contains(request: PrStewardDeliveryRequest): boolean {
    return this.#emitted.has(this.#fingerprint(request));
  }

  remember(request: PrStewardDeliveryRequest): void {
    this.#emitted.add(this.#fingerprint(request));
    if (this.#emitted.size > 128) {
      for (const oldest of this.#emitted) {
        this.#emitted.delete(oldest);
        break;
      }
    }
  }

  #fingerprint(request: PrStewardDeliveryRequest): string {
    return createHash('sha256').update(request.data).digest('hex');
  }
}
