import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  AgentAttemptParentKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  TeamKey,
} from '../../src/module-delivery/index.ts';
import type { ModuleDeliveryPlanV2 } from '../../src/module-delivery/index.ts';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CORE_ROOT = 'nook-app/nook-platform/nook-core';

function cliPlan(): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 1,
    sourceCommit: SOURCE_COMMIT,
    maxConcurrency: 1,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: [...REQUIRED_PARENT_OWNED_RESOURCES],
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [
      {
        kind: ModuleDeliveryTaskKind.ReadOnly,
        taskId: 'core-audit',
        team: TeamKey.DevelopmentCore,
        functionalOwner: TeamKey.Ai,
        acceptanceOwner: TeamKey.Ai,
        parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
        expert: 'core_expert',
        moduleRoot: CORE_ROOT,
        consumerOutcome: 'The delivery owner receives reviewed core evidence.',
        baseline: {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit: SOURCE_COMMIT,
        },
        agentDepthLimit: 2,
        dependencies: [],
        resources: {
          read: [`${CORE_ROOT}/**`],
          write: [],
          evidenceSurface: [`${CORE_ROOT}/**`],
        },
        parentOwnedExclusions: [...REQUIRED_PARENT_OWNED_RESOURCES],
        acceptance: {
          commands: ['task loom:module-experts:validate'],
          evidence: ['Core expert evidence is complete.'],
        },
      },
    ],
    edgeContracts: [],
  };
}

function resultLine(output: string): string {
  return output.split('\n').find((line) => line.startsWith('{"status"')) ?? '';
}

test('module delivery CLI validates one plan file with deterministic JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-module-delivery-cli-'));
  const cleanupOptions: RmOptions = { recursive: true, force: true };
  try {
    const acceptedPath = join(directory, 'accepted.json');
    const rejectedPath = join(directory, 'rejected.json');
    await writeFile(acceptedPath, JSON.stringify(cliPlan()), 'utf8');
    await writeFile(rejectedPath, '{', 'utf8');

    const acceptedCommand = [
      'task',
      '--dir',
      REPOSITORY_ROOT,
      'loom:module-delivery:validate',
      `PLAN=${acceptedPath}`,
    ];
    const acceptedOptions = {
      cmd: acceptedCommand,
      stderr: 'pipe' as const,
      stdout: 'pipe' as const,
    };
    const first = Bun.spawnSync(acceptedOptions);
    const second = Bun.spawnSync(acceptedOptions);
    expect(first.exitCode).toBe(0);
    const firstResult = resultLine(first.stdout.toString());
    const secondResult = resultLine(second.stdout.toString());
    expect(firstResult).toBe(secondResult);
    expect(firstResult).toContain('"status":"accepted"');
    expect(firstResult).toMatch(/"planDigest":"[0-9a-f]{64}"/u);

    const rejectedCommand = [
      'task',
      '--dir',
      REPOSITORY_ROOT,
      'loom:module-delivery:validate',
      `PLAN=${rejectedPath}`,
    ];
    const rejectedOptions = {
      cmd: rejectedCommand,
      stderr: 'pipe' as const,
      stdout: 'pipe' as const,
    };
    const rejected = Bun.spawnSync(rejectedOptions);
    expect(rejected.exitCode).not.toBe(0);
    expect(resultLine(rejected.stdout.toString())).toContain(
      '"status":"rejected"',
    );
  } finally {
    await rm(directory, cleanupOptions);
  }
});
