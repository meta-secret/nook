import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
} from '../../src/module-delivery/index.ts';

import type {
  LegacyModuleDeliveryPlan,
  ModuleDeliveryPlanV4,
} from '../../src/module-delivery/index.ts';

import { TeamKey } from '../../src/team-agents/catalog.ts';

export class ModuleDeliveryCliScenario {
  private constructor(private readonly request: string) {}

  static cliPlan(): ModuleDeliveryPlanV4 {
    return {
      version: 4,
      generation: 1,
      sourceCommit: SOURCE_COMMIT,
      originMainSha: ORIGIN_MAIN_SHA,
      pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
      featureHeadSha: PINNED_LOCAL_DEV_SHA,
      maxAgentDepth: 2,
      maxAttempts: 2,
      parentOwnedResources: [...REQUIRED_PARENT_OWNED_RESOURCES],
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
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
          consumerOutcome:
            'The delivery owner receives reviewed core evidence.',
          baseline: {
            kind: ModuleDeliveryBaselineKind.SourceCommit,
            sourceCommit: PINNED_LOCAL_DEV_SHA,
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

  static legacyCliPlan(): LegacyModuleDeliveryPlan {
    return {
      version: 1,
      sourceCommit: SOURCE_COMMIT,
      maxAgentDepth: 2,
      maxAttempts: 2,
      parentOwnedResources: [...REQUIRED_PARENT_OWNED_RESOURCES],
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
        owner: 'delivery-owner',
        validationCommands: ['task loom:verify'],
      },
      nodes: [
        {
          kind: ModuleDeliveryTaskKind.ReadOnly,
          taskId: 'legacy-core-audit',
          expert: 'core_expert',
          moduleRoot: CORE_ROOT,
          consumerOutcome: 'Legacy evidence is decoded for compatibility only.',
          baseline: {
            kind: ModuleDeliveryBaselineKind.SourceCommit,
            sourceCommit: SOURCE_COMMIT,
          },
          agentDepthLimit: 2,
          dependencies: [],
          resources: { read: [`${CORE_ROOT}/**`], write: [] },
          parentOwnedExclusions: [...REQUIRED_PARENT_OWNED_RESOURCES],
          acceptance: {
            commands: ['task loom:module-experts:validate'],
            evidence: ['Legacy evidence is complete.'],
          },
        },
      ],
      edgeContracts: [],
    };
  }

  static resultLine(output: string): string {
    return new ModuleDeliveryCliScenario(output).execute();
  }

  private execute(): string {
    const output = this.request;
    const [defaulted1 = ''] = [
      output.split('\n').find((line) => line.startsWith('{"status"')),
    ];
    return defaulted1;
  }
}

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../..');

const SOURCE_COMMIT = '3'.repeat(40);

const ORIGIN_MAIN_SHA = '1'.repeat(40);

const PINNED_LOCAL_DEV_SHA = '2'.repeat(40);

const CORE_ROOT = 'nook-app/nook-platform/nook-core';

test('module delivery CLI validates one plan file with deterministic JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-module-delivery-cli-'));
  const cleanupOptions: RmOptions = { recursive: true, force: true };
  try {
    const acceptedPath = join(directory, 'accepted.json');
    const legacyPath = join(directory, 'legacy.json');
    const rejectedPath = join(directory, 'rejected.json');
    await writeFile(
      acceptedPath,
      JSON.stringify(ModuleDeliveryCliScenario.cliPlan()),
      'utf8',
    );
    await writeFile(
      legacyPath,
      JSON.stringify(ModuleDeliveryCliScenario.legacyCliPlan()),
      'utf8',
    );
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
    const firstResult = ModuleDeliveryCliScenario.resultLine(
      first.stdout.toString(),
    );
    const secondResult = ModuleDeliveryCliScenario.resultLine(
      second.stdout.toString(),
    );
    expect(firstResult).toBe(secondResult);
    expect(firstResult).toContain('"status":"accepted"');
    expect(firstResult).toContain('"inputVersion":4');
    expect(firstResult).toMatch(/"planDigest":"[0-9a-f]{64}"/u);

    const legacyCommand = [
      'task',
      '--dir',
      REPOSITORY_ROOT,
      'loom:module-delivery:validate',
      `PLAN=${legacyPath}`,
    ];
    const legacyOptions = {
      cmd: legacyCommand,
      stderr: 'pipe' as const,
      stdout: 'pipe' as const,
    };
    const legacy = Bun.spawnSync(legacyOptions);
    expect(legacy.exitCode).not.toBe(0);
    expect(
      ModuleDeliveryCliScenario.resultLine(legacy.stdout.toString()),
    ).toContain('Canonical CLI admission requires plan version 4.');

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
    expect(
      ModuleDeliveryCliScenario.resultLine(rejected.stdout.toString()),
    ).toContain('"status":"rejected"');
  } finally {
    await rm(directory, cleanupOptions);
  }
});
