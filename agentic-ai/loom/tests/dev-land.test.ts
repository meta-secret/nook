import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import { DevLandCommand } from '../src/dev-delivery/dev-land.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  CommitSha,
  DevFailureKind,
} from '../src/dev-delivery/dev-types.ts';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';

class RecordingRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Result<CommandOutput, never> {
    this.requests.push(request);
    return ok({ exitCode: 0, stdout: '', stderr: '' });
  }
}

test(
  'dev:land rejects a canonical feature frontier that differs from its published head',
  () => {
    const originMainSha = CommitSha.parse(SHA_A);
    const pinnedLocalDevSha = CommitSha.parse(SHA_A);
    const featureHeadSha = CommitSha.parse(SHA_A);
    const expectedFeatureSha = CommitSha.parse(SHA_B);
    expect(originMainSha.isOk()).toBe(true);
    expect(pinnedLocalDevSha.isOk()).toBe(true);
    expect(featureHeadSha.isOk()).toBe(true);
    expect(expectedFeatureSha.isOk()).toBe(true);
    if (
      originMainSha.isErr() ||
      pinnedLocalDevSha.isErr() ||
      featureHeadSha.isErr() ||
      expectedFeatureSha.isErr()
    )
      return;

    const runner = new RecordingRunner();
    const result = new DevLandCommand(
      new DevDeliveryWorkspace({ root: '/tmp/nook-dev-land', runner }),
    ).execute({
      devPath: '/tmp/nook-dev-land',
      originMainSha: originMainSha.value,
      pinnedLocalDevSha: pinnedLocalDevSha.value,
      featureHeadSha: featureHeadSha.value,
      expectedFeatureSha: expectedFeatureSha.value,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error.kind).toBe(DevFailureKind.Configuration);
    expect(
      runner.requests.some(
        ({ executable }) => executable === CommandExecutable.Git,
      ),
    ).toBe(false);
  },
);
