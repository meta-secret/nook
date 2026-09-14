import { err, type Result } from 'neverthrow';
import type { PrePushRequest } from '../codec/args/pre-push.ts';

import { LoomFailureCode } from '../loom-failure.ts';

/**
 * @deprecated Feature and delivery validation are owned by remote build-only
 * execution and the manager's later CI cycle. Kept as an inert compatibility
 * boundary for old request payloads.
 */
export class PrePushCommand {
  constructor(
    private readonly input: {
      readonly request: PrePushRequest;
      readonly repoRoot: string;
    },
  ) {}
  async execute(): Promise<Result<PrePushReport, PrePushFailure>> {
    void this.input;
    return err({
      code: LoomFailureCode.CommandFailed,
      message:
        'prePush is deprecated and does not execute; use remote build:compile and the manager-owned CI validation cycle',
    });
  }
}

export type PrePushReport = {
  readonly formatOk: boolean;
  readonly uiDemoOk: boolean;
  readonly baseSha: string;
  readonly staged: boolean;
  readonly messages: string[];
};

export type PrePushFailure = {
  readonly code: LoomFailureCode.CommandFailed;
  readonly message: string;
};
