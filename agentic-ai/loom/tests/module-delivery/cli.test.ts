import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
} from '../../src/module-delivery/index.ts';

import type { ModuleDeliveryPlanV7 } from '../../src/module-delivery/index.ts';

import { ModuleDeliveryPlanValidationScenario } from './plan-validation.fixture.ts';
import { TeamKey } from '../../src/project-context/catalog.ts';

export class ModuleDeliveryCliScenario {
  constructor(private readonly planPath: string) {}

  static cliPlan(): ModuleDeliveryPlanV7 {
    return {
      version: 7,
      baseBranch: 'origin/main',
      featureBranch: 'codex/module-delivery-test',
      generation: 1,
      parentOwnedResources: [...REQUIRED_PARENT_OWNED_RESOURCES],
      parentJoin: {
        kind: ModuleDeliveryJoinKind.WorkerBranches,
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
          expert: 'core_expert',
          moduleRoot: CORE_ROOT,
          consumerOutcome:
            'The delivery owner receives reviewed core evidence.',
          baseline: {
            kind: ModuleDeliveryBaselineKind.FeatureBranch,
          },
          dependencies: [],
          resources: {
            read: [`${CORE_ROOT}/**`],
            write: [],
            evidenceSurface: [`${CORE_ROOT}/**`],
          },
          parentOwnedExclusions: [...REQUIRED_PARENT_OWNED_RESOURCES],
          acceptance: {
            commands: [
              {
                selector: 'task loom:module-experts:validate',
                read: [`${CORE_ROOT}/**`],
                write: [],
                output: [`${CORE_ROOT}/**`],
              },
            ],
            evidence: ['Core expert evidence is complete.'],
          },
        },
      ],
      edgeContracts: [],
    };
  }

  validate() {
    const options = {
      cmd: [
        'task',
        '--dir',
        REPOSITORY_ROOT,
        'loom:module-delivery:validate',
        `PLAN=${this.planPath}`,
      ],
      stderr: 'pipe' as const,
      stdout: 'pipe' as const,
    };
    const result = Bun.spawnSync(options);
    const [resultLine = ''] = [
      result.stdout
        .toString()
        .split('\n')
        .find((line) => line.startsWith('{"status"')),
    ];
    return { exitCode: result.exitCode, resultLine };
  }
}

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../..');

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
      JSON.stringify(ModuleDeliveryPlanValidationScenario.legacyPlan()),
      'utf8',
    );
    await writeFile(rejectedPath, '{', 'utf8');

    const accepted = new ModuleDeliveryCliScenario(acceptedPath);
    const first = accepted.validate();
    const second = accepted.validate();
    expect(first.exitCode).toBe(0);
    expect(first.resultLine).toBe(second.resultLine);
    expect(first.resultLine).toContain('"status":"accepted"');
    expect(first.resultLine).toContain('"inputVersion":7');
    expect(first.resultLine).toMatch(/"planDigest":"[0-9a-f]{64}"/u);

    const legacy = new ModuleDeliveryCliScenario(legacyPath).validate();
    expect(legacy.exitCode).not.toBe(0);
    expect(legacy.resultLine).toContain(
      'only canonical plan version 6 is accepted',
    );

    const rejected = new ModuleDeliveryCliScenario(rejectedPath).validate();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.resultLine).toContain('"status":"rejected"');
  } finally {
    await rm(directory, cleanupOptions);
  }
}, 15_000);
