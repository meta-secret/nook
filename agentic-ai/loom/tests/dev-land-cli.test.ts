import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import { DevCli } from '../src/dev-delivery/dev-cli.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  BranchName,
  CommandExecutable,
  CommitSha,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
} from '../src/dev-delivery/dev-types.ts';

const ORIGIN_MAIN_SHA = 'a'.repeat(40);
const PINNED_LOCAL_DEV_SHA = 'b'.repeat(40);
const FEATURE_BRANCH = 'codex/agent-branching';
const DEV_PATH = '/tmp/nook-dev';

test('resolves the branch and base dev:land packet without feature SHA input', () => {
  const names = [
    'DEV_PATH',
    'FEATURE_BRANCH',
    'ORIGIN_MAIN_SHA',
    'PINNED_LOCAL_DEV_SHA',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    DEV_PATH,
    FEATURE_BRANCH,
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
  });
  try {
    const packet = DevCli.requiredDevLandPacket();
    expect(packet.isOk()).toBe(true);
    if (packet.isErr()) return;
    expect(packet.value.devPath).toBe(DEV_PATH);
    expect(packet.value.featureBranch.value()).toBe(FEATURE_BRANCH);
    expect(packet.value.originMainSha.value()).toBe(ORIGIN_MAIN_SHA);
    expect(packet.value.pinnedLocalDevSha.value()).toBe(PINNED_LOCAL_DEV_SHA);
    expect(Object.hasOwn(packet.value, 'featureHeadSha')).toBe(false);
    expect(Object.hasOwn(packet.value, 'expectedFeatureSha')).toBe(false);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});

test('rejects missing and invalid dev:land branch identity', () => {
  const names = [
    'DEV_PATH',
    'FEATURE_BRANCH',
    'ORIGIN_MAIN_SHA',
    'PINNED_LOCAL_DEV_SHA',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    DEV_PATH,
    FEATURE_BRANCH,
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
  });
  try {
    delete process.env.FEATURE_BRANCH;
    const missing = DevCli.requiredDevLandPacket();
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.message).toContain('FEATURE_BRANCH');

    process.env.FEATURE_BRANCH = 'feature/land';
    const nonCanonical = DevCli.requiredDevLandPacket();
    expect(nonCanonical.isErr()).toBe(true);
    if (nonCanonical.isOk()) return;
    expect(nonCanonical.error.message).toContain('codex branch');

    process.env.FEATURE_BRANCH = 'codex//land';
    const malformed = DevCli.requiredDevLandPacket();
    expect(malformed.isErr()).toBe(true);
    if (malformed.isOk()) return;
    expect(malformed.error.message).toContain('malformed');
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});

class BranchOnlyRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  run(request: CommandRequest): Result<CommandOutput, never> {
    this.requests.push(request);
    if (
      request.executable === CommandExecutable.Git &&
      request.args[0] === 'branch' &&
      request.args[1] === '--show-current'
    ) {
      return ok({ exitCode: 0, stdout: `${FEATURE_BRANCH}\n`, stderr: '' });
    }
    throw new Error(`Unexpected command: ${request.args.join(' ')}`);
  }
}

test(
  'observes only the authorized branch when constructing the dev:land request',
  () => {
    const runner = new BranchOnlyRunner();
    const workspace = new DevDeliveryWorkspace({
      root: '/tmp/nook-dev-land',
      runner,
    });
    const featureBranch = BranchName.parseFeature(FEATURE_BRANCH);
    const originMainSha = CommitSha.parse(ORIGIN_MAIN_SHA);
    const pinnedLocalDevSha = CommitSha.parse(PINNED_LOCAL_DEV_SHA);
    expect(featureBranch.isOk()).toBe(true);
    expect(originMainSha.isOk()).toBe(true);
    expect(pinnedLocalDevSha.isOk()).toBe(true);
    if (
      featureBranch.isErr() ||
      originMainSha.isErr() ||
      pinnedLocalDevSha.isErr()
    )
      return;
    const packet = DevCli.observeDevLandRequest(workspace, {
      devPath: DEV_PATH,
      featureBranch: featureBranch.value,
      originMainSha: originMainSha.value,
      pinnedLocalDevSha: pinnedLocalDevSha.value,
    });

    expect(packet.isOk()).toBe(true);
    if (packet.isErr()) return;
    expect(Object.hasOwn(packet.value, 'featureHeadSha')).toBe(false);
    expect(Object.hasOwn(packet.value, 'expectedFeatureSha')).toBe(false);
    expect(runner.requests.some(({ args }) => args[0] === 'rev-parse')).toBe(
      false,
    );
  },
);

test('rejects missing, empty, relative, and NUL-containing dev checkout paths', () => {
  const names = [
    'DEV_PATH',
    'FEATURE_BRANCH',
    'ORIGIN_MAIN_SHA',
    'PINNED_LOCAL_DEV_SHA',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    DEV_PATH,
    FEATURE_BRANCH,
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
  });
  try {
    for (const value of [
      undefined,
      '',
      'relative/dev',
      `${DEV_PATH}\u0000dev`,
    ]) {
      if (typeof value === 'string') process.env.DEV_PATH = value;
      else delete process.env.DEV_PATH;
      const packet = DevCli.requiredDevLandPacket();
      expect(packet.isErr()).toBe(true);
      if (packet.isOk()) return;
      expect(packet.error.message).toContain('DEV_PATH');
    }
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});
