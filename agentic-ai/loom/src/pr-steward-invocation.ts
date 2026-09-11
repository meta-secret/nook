import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { PrStewardNdjsonCodec } from './pr-steward-contract.ts';
import type { PrStewardPullRequest } from './pr-steward-contract.ts';

export type PrStewardInvocation = {
  readonly pullRequest: PrStewardPullRequest;
  readonly credentialPath: string;
};

export class PrStewardInvocationCodec {
  static parse(argv: readonly string[]): PrStewardInvocation {
    if (
      (argv.length !== 2 && argv.length !== 4) ||
      argv[0] !== '--pr' ||
      (argv.length === 4 && argv[2] !== '--config')
    ) {
      throw new Error('expected --pr N [--config /absolute/path]');
    }
    const prText = argv[1]!;
    if (!/^[1-9][0-9]*$/.test(prText))
      throw new Error('pull request must be a positive integer');
    let pullRequest: PrStewardPullRequest;
    try {
      pullRequest = PrStewardNdjsonCodec.pullRequest(Number(prText));
    } catch {
      throw new Error('pull request must be a positive integer');
    }
    const path =
      argv.length === 4
        ? argv[3]!
        : join(homedir(), '.nook/events/pr-steward-client.yaml');
    if (!isAbsolute(path)) throw new Error('credential path must be absolute');
    return { pullRequest, credentialPath: path };
  }
}

