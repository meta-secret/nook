import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import { DevCli } from '../src/dev-delivery/dev-cli.ts';
import { DevDeliveryWorkspace } from '../src/dev-delivery/dev-workspace.ts';
import {
  BranchName,
  CommandExecutable,
  LocalBuildEvidenceController,
  LocalBuildEvidenceSelectionAuthorization,
  LocalBuildTask,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
} from '../src/dev-delivery/dev-types.ts';

const FEATURE_BRANCH = 'codex/agent-branching';

test('resolves the public dev:land packet from its canonical branch only', () => {
  const names = ['FEATURE_BRANCH'] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    FEATURE_BRANCH,
  });
  try {
    const packet = DevCli.requiredDevLandPacket();
    expect(packet.isOk()).toBe(true);
    if (packet.isErr()) return;
    expect(packet.value.featureBranch.value()).toBe(FEATURE_BRANCH);
    expect(Object.hasOwn(packet.value, 'devPath')).toBe(false);
    expect(Object.hasOwn(packet.value, 'originMainSha')).toBe(false);
    expect(Object.hasOwn(packet.value, 'pinnedLocalDevSha')).toBe(false);
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
  const names = ['FEATURE_BRANCH'] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    FEATURE_BRANCH,
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

test('accepts only the Prime-authorized long canonical feature branch', () => {
  const previous = process.env.FEATURE_BRANCH;
  try {
    process.env.FEATURE_BRANCH = 'codex/agentic-pipeline-delivery';
    const authorized = DevCli.requiredDevLandPacket();
    expect(authorized.isOk()).toBe(true);
    if (authorized.isOk()) {
      expect(authorized.value.featureBranch.value()).toBe(
        'codex/agentic-pipeline-delivery',
      );
    }

    for (const branch of [
      'codex/agentic-pipeline-deliveries',
      'codex/agentic-pipeline-delivery-extra',
      'codex/agentic-pipeline-delivery/tmp',
      'codex/agentic-pipeline-delivery/delivery-pipeline/pr-lifecycle/repair-feature-branch-validator',
    ]) {
      process.env.FEATURE_BRANCH = branch;
      const rejected = DevCli.requiredDevLandPacket();
      expect(rejected.isErr()).toBe(true);
      if (rejected.isErr()) {
        expect(rejected.error.message).toContain('malformed');
      }
    }
  } finally {
    if (typeof previous === 'string') process.env.FEATURE_BRANCH = previous;
    else delete process.env.FEATURE_BRANCH;
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

test('observes only the authorized branch when constructing the dev:land request', () => {
  const runner = new BranchOnlyRunner();
  const workspace = new DevDeliveryWorkspace({
    root: '/tmp/nook-dev-land',
    runner,
  });
  const featureBranch = BranchName.parseFeature(FEATURE_BRANCH);
  expect(featureBranch.isOk()).toBe(true);
  if (featureBranch.isErr()) return;
  const packet = DevCli.observeDevLandRequest(workspace, {
    featureBranch: featureBranch.value,
  });

  expect(packet.isOk()).toBe(true);
  if (packet.isErr()) return;
  expect(Object.hasOwn(packet.value, 'featureHeadSha')).toBe(false);
  expect(Object.hasOwn(packet.value, 'expectedFeatureSha')).toBe(false);
  expect(runner.requests.some(({ args }) => args[0] === 'rev-parse')).toBe(
    false,
  );
});

test('does not require a caller-selected dev checkout path', () => {
  const names = ['FEATURE_BRANCH'] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    FEATURE_BRANCH,
  });
  try {
    delete process.env.DEV_PATH;
    const packet = DevCli.requiredDevLandPacket();
    expect(packet.isOk()).toBe(true);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});

test('requires explicit one-off authorization before selecting local build evidence', () => {
  const names = [
    'FEATURE_BRANCH',
    'LOCAL_BUILD_EVIDENCE_PATH',
    'LOCAL_BUILD_EVIDENCE_AUTHORIZATION',
    'LOCAL_BUILD_EVIDENCE_SOURCE_SHA',
    'LOCAL_BUILD_EVIDENCE_TASK',
    'LOCAL_BUILD_EVIDENCE_ARTIFACT_DIGEST',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    FEATURE_BRANCH,
    LOCAL_BUILD_EVIDENCE_PATH:
      '/tmp/nook-dev-land/.nook/local-build-evidence/proof.json',
  });
  try {
    const unauthorized = DevCli.requiredDevLandPacket();
    expect(unauthorized.isErr()).toBe(true);
    if (unauthorized.isErr())
      expect(unauthorized.error.message).toContain('Gizmo Prime');

    process.env.LOCAL_BUILD_EVIDENCE_AUTHORIZATION = 'one-off-local';
    const generatorMarkerIsNotPrimeAuthority = DevCli.requiredDevLandPacket();
    expect(generatorMarkerIsNotPrimeAuthority.isErr()).toBe(true);
    if (generatorMarkerIsNotPrimeAuthority.isErr())
      expect(generatorMarkerIsNotPrimeAuthority.error.message).toContain(
        'Gizmo Prime',
      );

    Object.assign(process.env, {
      LOCAL_BUILD_EVIDENCE_AUTHORIZATION:
        LocalBuildEvidenceSelectionAuthorization.GizmoPrimeOneOff,
      LOCAL_BUILD_EVIDENCE_SOURCE_SHA:
        '1111111111111111111111111111111111111111',
      LOCAL_BUILD_EVIDENCE_TASK: 'build',
      LOCAL_BUILD_EVIDENCE_ARTIFACT_DIGEST: `sha256:${'a'.repeat(64)}`,
    });
    const authorized = DevCli.requiredDevLandPacket();
    expect(authorized.isOk()).toBe(true);
    if (authorized.isOk()) {
      const evidence = authorized.value.localBuildEvidence;
      expect(evidence?.path).toBe(
        '/tmp/nook-dev-land/.nook/local-build-evidence/proof.json',
      );
      expect(evidence?.authorization).toBe(
        LocalBuildEvidenceSelectionAuthorization.GizmoPrimeOneOff,
      );
      expect(evidence?.controller).toBe(
        LocalBuildEvidenceController.GizmoPrime,
      );
      expect(evidence?.sourceSha.value()).toBe(
        '1111111111111111111111111111111111111111',
      );
      expect(evidence?.task).toBe(LocalBuildTask.Build);
      expect(evidence?.artifactDigest).toBe(`sha256:${'a'.repeat(64)}`);
    }
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});
