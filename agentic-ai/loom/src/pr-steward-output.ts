import {
  PrStewardBlockerCode,
  PrStewardRecordKind,
} from './pr-steward-contract.ts';
import type { PrStewardRecord } from './pr-steward-contract.ts';

export class PrStewardOutput {
  #lastBlocker = '';

  shouldEmit(request: { readonly record: PrStewardRecord }): boolean {
    const record = request.record;
    if (record.kind === PrStewardRecordKind.Routing) {
      this.#lastBlocker = '';
      return true;
    }
    const key = JSON.stringify({
      code: record.code,
      repository: record.repository,
      pullRequest: record.pullRequest,
      summary: record.summary,
      ...(record.code === PrStewardBlockerCode.GithubObservationUnavailable
        ? { source: record.source, headSha: record.headSha }
        : {}),
    });
    if (key === this.#lastBlocker) return false;
    this.#lastBlocker = key;
    return true;
  }
}
