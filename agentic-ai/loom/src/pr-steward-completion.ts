import { PrStewardPullRequestState } from './pr-steward-github.ts';
import type {
  PrStewardAssignedPrReader,
  PrStewardAssignedPrRequest,
  PrStewardAssignedPullRequest,
} from './pr-steward-github.ts';

type PrStewardCompletionRequest = {
  readonly reader: PrStewardAssignedPrReader;
  readonly target: PrStewardAssignedPrRequest;
  readonly finished: (result: PrStewardAssignedPullRequest) => void;
  readonly failed: (error: Error) => void;
};

export class PrStewardCompletion {
  readonly #request: PrStewardCompletionRequest;
  readonly #timer: ReturnType<typeof setInterval>;
  #active = true;
  #checking = false;

  constructor(request: PrStewardCompletionRequest) {
    this.#request = request;
    this.#timer = setInterval(() => {
      void this.#check();
    }, 300_000);
  }

  stop(): void {
    this.#active = false;
    clearInterval(this.#timer);
  }

  async #check(): Promise<void> {
    if (!this.#active || this.#checking) return;
    this.#checking = true;
    let result: PrStewardAssignedPullRequest;
    try {
      result = await this.#request.reader.read(this.#request.target);
    } catch {
      if (this.#active) {
        this.stop();
        this.#request.failed(
          new Error('Assigned pull request completion observation is unavailable.'),
        );
      }
      return;
    } finally {
      this.#checking = false;
    }
    if (!this.#active || result.state === PrStewardPullRequestState.Open)
      return;
    this.stop();
    this.#request.finished(result);
  }
}
