import { describe, expect, test } from 'bun:test';

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { TaskTerminalKind } from '../../src/agent-workflow/domain.ts';

import { DelegationRunFinalization } from '../../src/agent-workflow/delegation-aggregation.ts';

import type {
  DelegationBarrierEvidence,
  DelegationChildTerminalEvidence,
  DelegationFinalizationRequest,
  FinalizeDelegationRunInput,
  DelegationRunResultV1,
} from '../../src/agent-workflow/delegation-aggregation.ts';

import { DelegationRunJournal } from '../../src/agent-workflow/delegation-run-journal.ts';

import type {
  AdmitDelegationAttemptInput,
  StartDelegationRunInput,
} from '../../src/agent-workflow/delegation-run-journal.ts';

import {
  AgentWorkflowDelegationAggregationScenario,
  REMOVE_OPTIONS,
} from './delegation-aggregation-fixtures.ts';

import type {
  AdmissionForInput,
  FixtureInput,
  RecordDeclarationInput,
  RecordedAttempt,
  StartAndAdmitInput,
} from './delegation-aggregation-fixtures.ts';

const NONCOMPLETED_KINDS: readonly TaskTerminalKind[] = [
  TaskTerminalKind.Failed,
  TaskTerminalKind.Blocked,
  TaskTerminalKind.Cancelled,
  TaskTerminalKind.TimedOut,
  TaskTerminalKind.Skipped,
];

describe('ordinary delegation run aggregation', () => {
  test('decodes and migrates the historical v1 run result without mutating it', () => {
    const historical: DelegationRunResultV1 = {
      schemaVersion:
        DelegationRunFinalization.LEGACY_DELEGATION_RUN_RESULT_SCHEMA_VERSION,
      runId: 'run-1',
      sourceCommit: 'a'.repeat(40),
      planSha256: 'd'.repeat(64),
      rootMaterializer: { task: 'root', agent: 'agent', attempt: 1 },
      attempts: [],
      barrierEvidence: [],
      materializedView: { path: 'view.md', sha256: 'e'.repeat(64) },
    };
    const before = structuredClone(historical);
    const decoded =
      DelegationRunFinalization.decodeCompatibleDelegationRunResult(
        JSON.stringify(historical),
      );
    expect(decoded).toEqual(historical);
    expect(Object.hasOwn(decoded, 'featureHeadSha')).toBe(false);
    expect(() =>
      DelegationRunFinalization.decodeDelegationRunResult(
        JSON.stringify(historical),
      ),
    ).toThrow('schema version is unsupported');
    const migrated = DelegationRunFinalization.migrateDelegationRunResult({
      result: historical,
      featureHeadSha: 'f'.repeat(40),
      originMainSha: 'b'.repeat(40),
      pinnedLocalDevSha: 'c'.repeat(40),
    });
    expect(historical).toEqual(before);
    expect(migrated.schemaVersion).toBe(
      DelegationRunFinalization.DELEGATION_RUN_RESULT_SCHEMA_VERSION,
    );
    expect(migrated.originMainSha).toBe('b'.repeat(40));
    expect(migrated.pinnedLocalDevSha).toBe('c'.repeat(40));
    expect(migrated.featureHeadSha).toBe('f'.repeat(40));
  });

  test('recursively closes three tiers, retains failure evidence, and is idempotent', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'three-tier-closure',
        leafKind: TaskTerminalKind.Failed,
      };
      const fixture =
        await AgentWorkflowDelegationAggregationScenario.completeFixture(
          fixtureInput,
        );
      const runEventsPath = join(fixture.runDirectory, 'events.jsonl');
      const eventsBeforeFinalization = await readFile(runEventsPath, 'utf8');
      const legacyTemporaryPath = join(
        fixture.runDirectory,
        'run-result.json.tmp',
      );
      await writeFile(legacyTemporaryPath, 'Interrupted projection.\n', 'utf8');
      const concurrent = await Promise.all([
        DelegationRunFinalization.finalizeDelegationRun(
          fixture.finalizationInput,
        ),
        DelegationRunFinalization.finalizeDelegationRun(
          fixture.finalizationInput,
        ),
      ]);
      const first = concurrent[0];
      if (!first) throw new Error('Finalization result is missing.');
      expect(concurrent[1]).toEqual(first);
      const firstResult = await readFile(first.resultPath, 'utf8');
      const firstView = await readFile(first.viewPath, 'utf8');
      expect(
        first.result.attempts.map((attempt) => attempt.terminalKind),
      ).toEqual([
        TaskTerminalKind.Completed,
        TaskTerminalKind.Completed,
        TaskTerminalKind.Failed,
      ]);
      expect(firstView).toBe(
        '# Root aggregate\n\nAll child evidence reconciled.\n',
      );

      const second = await DelegationRunFinalization.finalizeDelegationRun(
        fixture.finalizationInput,
      );
      expect(second).toEqual(first);
      expect(await readFile(second.resultPath, 'utf8')).toBe(firstResult);
      expect(await readFile(second.viewPath, 'utf8')).toBe(firstView);
      expect(await readFile(runEventsPath, 'utf8')).toBe(
        eventsBeforeFinalization,
      );
      await expect(stat(legacyTemporaryPath)).rejects.toThrow();

      const admissionFixture: AdmissionForInput = {
        workingDirectory,
        plan: fixture.plan,
        declaration: AgentWorkflowDelegationAggregationScenario.itemAt([
          fixture.plan.attempts,
          0,
        ]),
      };
      const admissionInput =
        AgentWorkflowDelegationAggregationScenario.admissionFor(
          admissionFixture,
        );
      await expect(
        DelegationRunJournal.admitDelegationAttempt(admissionInput),
      ).rejects.toThrow('already finalized');
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('retains every non-completed child terminal as barrier evidence', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      for (const kind of NONCOMPLETED_KINDS) {
        const fixtureInput: FixtureInput = {
          workingDirectory,
          runId: `terminal-${kind}`,
          leafKind: kind,
        };
        const fixture =
          await AgentWorkflowDelegationAggregationScenario.completeFixture(
            fixtureInput,
          );
        const receipt = await DelegationRunFinalization.finalizeDelegationRun(
          fixture.finalizationInput,
        );
        expect(receipt.result.attempts[2]?.terminalKind).toBe(kind);
        expect(
          receipt.result.barrierEvidence[1]?.children[0]?.terminalKind,
        ).toBe(kind);
      }
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('fails closed on missing terminal and mismatched barrier manifest', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const plan =
        AgentWorkflowDelegationAggregationScenario.threeTierPlan(
          'missing-terminal',
        );
      const startInput: StartAndAdmitInput = { workingDirectory, plan };
      const runDirectory =
        await AgentWorkflowDelegationAggregationScenario.startAndAdmit(
          startInput,
        );
      const recorded = new Map<string, RecordedAttempt>();
      const incompleteRequest: DelegationFinalizationRequest = {
        runId: plan.runId,
        sourceCommit: plan.sourceCommit,
        originMainSha: plan.originMainSha,
        pinnedLocalDevSha: plan.pinnedLocalDevSha,
        featureHeadSha: plan.pinnedLocalDevSha,
        barrierEvidence: [],
      };
      const incompleteInput: FinalizeDelegationRunInput = {
        workingDirectory,
        request: incompleteRequest,
      };
      await expect(
        DelegationRunFinalization.finalizeDelegationRun(incompleteInput),
      ).rejects.toThrow('requires every planned admission');
      const expertRecord: RecordDeclarationInput = {
        runDirectory,
        plan,
        declaration: AgentWorkflowDelegationAggregationScenario.itemAt([
          plan.attempts,
          1,
        ]),
        terminalKind: TaskTerminalKind.Completed,
        recorded,
      };
      await AgentWorkflowDelegationAggregationScenario.recordDeclaration(
        expertRecord,
      );
      await AgentWorkflowDelegationAggregationScenario.admitDepthThree(
        startInput,
      );
      const rootRecord: RecordDeclarationInput = {
        runDirectory,
        plan,
        declaration: AgentWorkflowDelegationAggregationScenario.itemAt([
          plan.attempts,
          0,
        ]),
        terminalKind: TaskTerminalKind.Completed,
        recorded,
      };
      await AgentWorkflowDelegationAggregationScenario.recordDeclaration(
        rootRecord,
      );
      await expect(
        DelegationRunFinalization.finalizeDelegationRun(incompleteInput),
      ).rejects.toThrow('Agent attempt artifact is invalid');

      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'mismatched-manifest',
        leafKind: TaskTerminalKind.Blocked,
      };
      const fixture =
        await AgentWorkflowDelegationAggregationScenario.completeFixture(
          fixtureInput,
        );
      const barriers = fixture.finalizationInput.request.barrierEvidence;
      const expertBarrier = barriers[1];
      if (!expertBarrier) throw new Error('Expert barrier fixture is missing.');
      const child = expertBarrier.children[0];
      if (!child) throw new Error('Child barrier fixture is missing.');
      const forgedChild: DelegationChildTerminalEvidence = {
        ...child,
        resultSha256: 'f'.repeat(64),
      };
      const forgedBarrier: DelegationBarrierEvidence = {
        ...expertBarrier,
        children: [forgedChild],
      };
      const forgedRequest: DelegationFinalizationRequest = {
        ...fixture.finalizationInput.request,
        barrierEvidence: [
          AgentWorkflowDelegationAggregationScenario.itemAt([barriers, 0]),
          forgedBarrier,
          AgentWorkflowDelegationAggregationScenario.itemAt([barriers, 2]),
        ],
      };
      const forgedInput: FinalizeDelegationRunInput = {
        workingDirectory,
        request: forgedRequest,
      };
      await expect(
        DelegationRunFinalization.finalizeDelegationRun(forgedInput),
      ).rejects.toThrow('does not match child projections');
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });
});
