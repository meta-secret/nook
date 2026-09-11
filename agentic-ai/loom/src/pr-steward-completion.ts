import { PrStewardCompletionState } from './pr-steward-checks.ts';
import type {
  PrStewardCompletionReader,
  PrStewardCompletionSnapshot,
} from './pr-steward-checks.ts';
import type { PrStewardHeadSha } from './pr-steward-contract.ts';
import type { PrStewardAssignedPrRequest } from './pr-steward-github.ts';

type PrStewardCompletionRequest = {
  readonly reader: PrStewardCompletionReader;
  readonly target: PrStewardAssignedPrRequest;
  readonly finished: (result: PrStewardCompletionSnapshot) => void;
  readonly failed: (error: Error) => void;
};

export class PrStewardCompletion {
  readonly #request: PrStewardCompletionRequest;
  #timer: ReturnType<typeof setTimeout> | false = false;
  #active = true;
  #lastActivity = performance.now();
  #generation = 0;
  #checking = false;
  #requested = false;
  #head: PrStewardHeadSha | false = false;

  constructor(request: PrStewardCompletionRequest) {
    this.#request = request;
  }

  start(): void {
    void this.#evaluate();
  }

  activity(request: { readonly checkEvent: boolean }): void {
    if (!this.#active) return;
    this.#lastActivity = performance.now();
    this.#generation += 1;
    this.#schedule(300_001);
    if (request.checkEvent) void this.#evaluate();
  }

  stop(): void {
    this.#active = false;
    if (this.#timer !== false) clearTimeout(this.#timer);
  }

  #schedule(delay: number): void {
    if (this.#timer !== false) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const idle = performance.now() - this.#lastActivity;
      if (idle <= 300_000) this.#schedule(300_001 - idle);
      else void this.#evaluate();
    }, delay);
  }

  async #evaluate(): Promise<void> {
    if (!this.#active) return;
    if (this.#checking) {
      this.#requested = true;
      return;
    }
    this.#checking = true;
    const generation = this.#generation;
    try {
      const result = await this.#request.reader.read(this.#request.target);
      if (!this.#active) return;
      if (this.#head === false) this.#head = result.headSha;
      if (result.headSha !== this.#head) {
        this.stop();
        this.#request.failed(
          new Error('Assigned pull request iteration head changed.'),
        );
        return;
      }
      if (generation !== this.#generation) return;
      if (result.state === PrStewardCompletionState.Monitoring) {
        this.#schedule(300_001);
        return;
      }
      this.stop();
      this.#request.finished(result);
    } catch {
      if (this.#active && generation === this.#generation) {
        this.stop();
        this.#request.failed(
          new Error(
            'Assigned pull request completion observation is unavailable.',
          ),
        );
      }
    } finally {
      this.#checking = false;
      if (this.#active && this.#requested) {
        this.#requested = false;
        void this.#evaluate();
      }
    }
  }
}
