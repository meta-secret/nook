import { createHash } from 'node:crypto';

// Only successfully emitted hints enter this bounded, process-local set.
export class PrStewardDeliveries {
  readonly #emitted = new Set<string>();

  fingerprint(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }

  contains(fingerprint: string): boolean {
    return this.#emitted.has(fingerprint);
  }

  remember(fingerprint: string): void {
    this.#emitted.add(fingerprint);
    if (this.#emitted.size > 128) {
      for (const oldest of this.#emitted) {
        this.#emitted.delete(oldest);
        break;
      }
    }
  }
}
