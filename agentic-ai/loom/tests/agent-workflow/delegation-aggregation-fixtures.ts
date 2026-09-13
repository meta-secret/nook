import { expect } from 'bun:test';

import { randomUUID } from 'node:crypto';

import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { join } from 'node:path';

import { AgentAttemptJournal } from '../../src/agent-workflow/agent-journal.ts';

import type { AgentAttemptJournalConfiguration } from '../../src/agent-workflow/agent-journal.ts';

import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';

import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';

import type {
  AgentAttemptProcessingReference,
  TaskTerminal,
} from '../../src/agent-workflow/domain.ts';

import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
  DelegationPlanContract,
} from '../../src/agent-workflow/delegation-domain.ts';

import type {
  DelegationAttemptDeclaration,
  DelegationPlan,
} from '../../src/agent-workflow/delegation-domain.ts';

import type {
  DelegationBarrierEvidence,
  DelegationFinalizationRequest,
  FinalizeDelegationRunInput,
} from '../../src/agent-workflow/delegation-aggregation.ts';

import { DelegationRunJournal } from '../../src/agent-workflow/delegation-run-journal.ts';

import type {
  AdmitDelegationAttemptInput,
  StartDelegationRunInput,
} from '../../src/agent-workflow/delegation-run-journal.ts';

import { CanonicalFeatureBranchContract } from '../../src/lib/base-evidence.ts';

export const REMOVE_OPTIONS: RmOptions = { recursive: true, force: true };

export const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const FEATURE_BRANCH = 'codex/hive-delegation-aggregation-tests';

export class AgentWorkflowDelegationAggregationScenario {
  private constructor(private readonly request: FixtureInput) {}

  static async killCrashHolder(input: KillCrashHolderInput): Promise<void> {
    const readyPath = join(input.runDirectory, `.crash-ready-${randomUUID()}`);
    const releasePath = join(
      input.runDirectory,
      `.crash-release-${randomUUID()}`,
    );
    const crashHolderPath = join(import.meta.dir, 'delegation-crash-holder.ts');
    const command = [
      process.execPath,
      crashHolderPath,
      input.runDirectory,
      readyPath,
      input.boundary,
      releasePath,
    ];
    const spawnOptions = { stdout: 'pipe', stderr: 'pipe' } as const;
    const child = Bun.spawn(command, spawnOptions);
    let ready = false;
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      try {
        await readFile(readyPath, 'utf8');
        ready = true;
        break;
      } catch {
        await Bun.sleep(10);
      }
    }
    if (!ready) {
      child.kill(9);
      const stderr = await new Response(child.stderr).text();
      throw new Error(`Crash holder did not become ready: ${stderr}`);
    }
    child.kill(9);
    await child.exited;
    await rm(readyPath, REMOVE_OPTIONS);
  }

  static async proveConcurrentSuccessorSerialization(
    runDirectory: string,
  ): Promise<void> {
    const firstPaths: SuccessorPaths = {
      readyPath: join(runDirectory, `.successor-ready-${randomUUID()}`),
      releasePath: join(runDirectory, `.successor-release-${randomUUID()}`),
    };
    const secondPaths: SuccessorPaths = {
      readyPath: join(runDirectory, `.successor-ready-${randomUUID()}`),
      releasePath: join(runDirectory, `.successor-release-${randomUUID()}`),
    };
    const crashHolderPath = join(import.meta.dir, 'delegation-crash-holder.ts');
    const firstCommand = [
      process.execPath,
      crashHolderPath,
      runDirectory,
      firstPaths.readyPath,
      CrashBoundary.LockHeld,
      firstPaths.releasePath,
    ];
    const secondCommand = [
      process.execPath,
      crashHolderPath,
      runDirectory,
      secondPaths.readyPath,
      CrashBoundary.LockHeld,
      secondPaths.releasePath,
    ];
    const spawnOptions = { stdout: 'pipe', stderr: 'pipe' } as const;
    const first = Bun.spawn(firstCommand, spawnOptions);
    const second = Bun.spawn(secondCommand, spawnOptions);
    try {
      const readiness: SuccessorReadiness = {
        firstReadyPath: firstPaths.readyPath,
        secondReadyPath: secondPaths.readyPath,
      };
      const firstEntered =
        await AgentWorkflowDelegationAggregationScenario.waitForSingleSuccessor(
          readiness,
        );
      await Bun.sleep(100);
      expect(
        await AgentWorkflowDelegationAggregationScenario.readySuccessorCount(
          readiness,
        ),
      ).toBe(1);

      const firstReleasePath = firstEntered
        ? firstPaths.releasePath
        : secondPaths.releasePath;
      const firstExit = firstEntered ? first.exited : second.exited;
      await writeFile(firstReleasePath, 'release\n', 'utf8');
      expect(await firstExit).toBe(0);

      const secondReadyPath = firstEntered
        ? secondPaths.readyPath
        : firstPaths.readyPath;
      const secondReleasePath = firstEntered
        ? secondPaths.releasePath
        : firstPaths.releasePath;
      const secondExit = firstEntered ? second.exited : first.exited;
      await AgentWorkflowDelegationAggregationScenario.waitForFilesystemPath(
        secondReadyPath,
      );
      await writeFile(secondReleasePath, 'release\n', 'utf8');
      expect(await secondExit).toBe(0);
    } finally {
      try {
        first.kill(9);
      } catch {
        // The successor already exited after its explicit release.
      }
      try {
        second.kill(9);
      } catch {
        // The successor already exited after its explicit release.
      }
      await rm(firstPaths.readyPath, REMOVE_OPTIONS);
      await rm(firstPaths.releasePath, REMOVE_OPTIONS);
      await rm(secondPaths.readyPath, REMOVE_OPTIONS);
      await rm(secondPaths.releasePath, REMOVE_OPTIONS);
    }
  }

  static async waitForSingleSuccessor(
    input: SuccessorReadiness,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      const firstReady =
        await AgentWorkflowDelegationAggregationScenario.filesystemPathExists(
          input.firstReadyPath,
        );
      const secondReady =
        await AgentWorkflowDelegationAggregationScenario.filesystemPathExists(
          input.secondReadyPath,
        );
      if (firstReady && secondReady) {
        throw new Error('Concurrent lifecycle successors both entered.');
      }
      if (firstReady || secondReady) return firstReady;
      await Bun.sleep(10);
    }
    throw new Error('No lifecycle successor acquired the recovered lock.');
  }

  static async readySuccessorCount(input: SuccessorReadiness): Promise<number> {
    const firstReady =
      await AgentWorkflowDelegationAggregationScenario.filesystemPathExists(
        input.firstReadyPath,
      );
    const secondReady =
      await AgentWorkflowDelegationAggregationScenario.filesystemPathExists(
        input.secondReadyPath,
      );
    return Number(firstReady) + Number(secondReady);
  }

  static async waitForFilesystemPath(path: string): Promise<void> {
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      if (
        await AgentWorkflowDelegationAggregationScenario.filesystemPathExists(
          path,
        )
      )
        return;
      await Bun.sleep(10);
    }
    throw new Error(`Expected lifecycle path was not written: ${path}`);
  }

  static async filesystemPathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false;
      }
      throw error;
    }
  }

  static itemAt<T>([items, index]: readonly [readonly T[], number]): T {
    const item = items[index];
    if (!item) throw new Error(`Missing fixture item at index ${index}.`);
    return item;
  }

  static completeFixture(input: FixtureInput): Promise<CompleteFixture> {
    return new AgentWorkflowDelegationAggregationScenario(input).execute();
  }

  private async execute(): Promise<CompleteFixture> {
    const input = this.request;
    const plan = AgentWorkflowDelegationAggregationScenario.threeTierPlan(
      input.runId,
    );
    const startInput: StartAndAdmitInput = {
      workingDirectory: input.workingDirectory,
      plan,
    };
    const runDirectory =
      await AgentWorkflowDelegationAggregationScenario.startAndAdmit(
        startInput,
      );
    const recorded = new Map<string, RecordedAttempt>();
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
    const admissionInput: StartAndAdmitInput = {
      workingDirectory: input.workingDirectory,
      plan,
    };
    await AgentWorkflowDelegationAggregationScenario.admitDepthThree(
      admissionInput,
    );
    const leafRecord: RecordDeclarationInput = {
      runDirectory,
      plan,
      declaration: AgentWorkflowDelegationAggregationScenario.itemAt([
        plan.attempts,
        2,
      ]),
      terminalKind: input.leafKind,
      recorded,
    };
    await AgentWorkflowDelegationAggregationScenario.recordDeclaration(
      leafRecord,
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
    const barrierInput: BarrierEvidenceInput = { plan, recorded };
    const request: DelegationFinalizationRequest = {
      runId: plan.runId,
      sourceCommit: plan.sourceCommit,
      originMainSha: plan.originMainSha,
      pinnedLocalDevSha: plan.pinnedLocalDevSha,
      featureHeadSha: plan.pinnedLocalDevSha,
      barrierEvidence:
        AgentWorkflowDelegationAggregationScenario.barrierEvidence(
          barrierInput,
        ),
    };
    return {
      plan,
      runDirectory,
      finalizationInput: { workingDirectory: input.workingDirectory, request },
    };
  }

  static async startAndAdmit(input: StartAndAdmitInput): Promise<string> {
    const startInput: StartDelegationRunInput = {
      workingDirectory: input.workingDirectory,
      plan: input.plan,
    };
    const receipt = await DelegationRunJournal.startDelegationRun(startInput);
    for (const declaration of input.plan.attempts) {
      if (declaration.depth === 3) continue;
      const admissionInput: AdmissionForInput = {
        workingDirectory: input.workingDirectory,
        plan: input.plan,
        declaration,
      };
      const admission =
        AgentWorkflowDelegationAggregationScenario.admissionFor(admissionInput);
      await DelegationRunJournal.admitDelegationAttempt(admission);
    }
    return receipt.runDirectory;
  }

  static async admitDepthThree(input: StartAndAdmitInput): Promise<void> {
    const declaration = input.plan.attempts.find(
      (candidate) => candidate.depth === 3,
    );
    if (!declaration) throw new Error('Depth-three fixture is missing.');
    const admissionInput: AdmissionForInput = {
      workingDirectory: input.workingDirectory,
      plan: input.plan,
      declaration,
    };
    await DelegationRunJournal.admitDelegationAttempt(
      AgentWorkflowDelegationAggregationScenario.admissionFor(admissionInput),
    );
  }

  static admissionFor(input: AdmissionForInput): AdmitDelegationAttemptInput {
    return {
      workingDirectory: input.workingDirectory,
      runId: input.plan.runId,
      request: {
        runId: input.plan.runId,
        sourceCommit: input.plan.sourceCommit,
        originMainSha: input.plan.originMainSha,
        pinnedLocalDevSha: input.plan.pinnedLocalDevSha,
        featureBranch: input.plan.featureBranch,
        identity: input.declaration.identity,
        depth: input.declaration.depth,
        parent: input.declaration.parent,
      },
    };
  }

  static async recordDeclaration(input: RecordDeclarationInput): Promise<void> {
    const configuration: AgentAttemptJournalConfiguration = {
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      runDirectory: input.runDirectory,
      runId: input.plan.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
      sourceCommit: input.plan.sourceCommit,
      originMainSha: input.plan.originMainSha,
      pinnedLocalDevSha: input.plan.pinnedLocalDevSha,
      featureHeadSha: input.plan.pinnedLocalDevSha,
      task: input.declaration.identity.task,
      agent: input.declaration.identity.agent,
      attempt: input.declaration.identity.attempt,
      depth: input.declaration.depth,
      parent: input.declaration.parent,
      now: () => '2026-08-26T00:00:00.000Z',
    };
    const preparedJournal = new AgentAttemptJournal<string>(configuration);
    const journal = await preparedJournal.initialize();
    const terminal =
      AgentWorkflowDelegationAggregationScenario.terminalFor(input);
    const processing = await journal.finalize(terminal);
    const recordedAttempt: RecordedAttempt = {
      terminalKind: input.terminalKind,
      processing,
    };
    input.recorded.set(
      DelegationPlanContract.delegationAttemptIdentityKey(
        input.declaration.identity,
      ),
      recordedAttempt,
    );
  }

  static terminalFor(input: RecordDeclarationInput): TaskTerminal<string> {
    const identity = input.declaration.identity;
    if (input.terminalKind !== TaskTerminalKind.Completed) {
      return {
        kind: input.terminalKind,
        task: identity.task,
        attempt: identity.attempt,
        summary: `${input.terminalKind} evidence retained.`,
      };
    }
    const root = input.declaration.depth === 1;
    return {
      kind: TaskTerminalKind.Completed,
      task: identity.task,
      attempt: identity.attempt,
      threadId: `thread-${identity.task}`,
      output: {
        resultKind: WorkflowResultKind.CortexEvidence,
        summary: root
          ? 'Root aggregate complete.'
          : 'Parent evidence complete.',
        materializedViewMarkdown: root
          ? '# Root aggregate\n\nAll child evidence reconciled.'
          : `# ${identity.task}\n\nEvidence complete.`,
        findings: [],
        notesForParent: [],
        artifacts: [],
      },
    };
  }

  static barrierEvidence(
    input: BarrierEvidenceInput,
  ): readonly DelegationBarrierEvidence[] {
    return input.plan.attempts.map((declaration) => ({
      parent: declaration.identity,
      children: declaration.terminalBarrier.attempts.map((identity) => {
        const recorded = input.recorded.get(
          DelegationPlanContract.delegationAttemptIdentityKey(identity),
        );
        if (
          !recorded ||
          recorded.processing.view.presence !==
            MaterializedViewPresence.Recorded
        ) {
          throw new Error('Recorded child evidence is missing.');
        }
        return {
          identity,
          terminalKind: recorded.terminalKind,
          resultSha256: recorded.processing.result.sha256,
          viewSha256: recorded.processing.view.projection.sha256,
        };
      }),
    }));
  }

  static threeTierPlan(runId: string): DelegationPlan {
    const rootIdentity = { task: 'root', agent: 'root-agent', attempt: 1 };
    const expertIdentity = {
      task: 'expert',
      agent: 'expert-agent',
      attempt: 1,
    };
    const leafIdentity = { task: 'leaf', agent: 'leaf-agent', attempt: 1 };
    const root: DelegationAttemptDeclaration = {
      identity: rootIdentity,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      terminalBarrier: {
        policy: DelegationBarrierPolicy.AllTerminal,
        attempts: [expertIdentity],
      },
    };
    const expert: DelegationAttemptDeclaration = {
      identity: expertIdentity,
      depth: 2,
      parent: { kind: AgentAttemptParentKind.AgentAttempt, ...rootIdentity },
      terminalBarrier: {
        policy: DelegationBarrierPolicy.AllTerminal,
        attempts: [leafIdentity],
      },
    };
    const leaf: DelegationAttemptDeclaration = {
      identity: leafIdentity,
      depth: 3,
      parent: { kind: AgentAttemptParentKind.AgentAttempt, ...expertIdentity },
      terminalBarrier: {
        policy: DelegationBarrierPolicy.AllTerminal,
        attempts: [],
      },
    };
    return {
      schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      runId,
      sourceCommit: SOURCE_COMMIT,
      originMainSha: SOURCE_COMMIT,
      pinnedLocalDevSha: SOURCE_COMMIT,
      featureBranch: CanonicalFeatureBranchContract.parse(FEATURE_BRANCH),
      rootMaterializer: rootIdentity,
      attempts: [root, expert, leaf],
    };
  }
}
export enum CrashBoundary {
  LockHeld = 'lock-held',
  TempWritten = 'temp-written',
}

export type KillCrashHolderInput = {
  readonly runDirectory: string;
  readonly boundary: CrashBoundary;
};

export type SuccessorPaths = {
  readonly readyPath: string;
  readonly releasePath: string;
};

export type SuccessorReadiness = {
  readonly firstReadyPath: string;
  readonly secondReadyPath: string;
};

export type FixtureInput = {
  readonly workingDirectory: string;
  readonly runId: string;
  readonly leafKind: TaskTerminalKind;
};

export type CompleteFixture = {
  readonly plan: DelegationPlan;
  readonly runDirectory: string;
  readonly finalizationInput: FinalizeDelegationRunInput;
};

export type StartAndAdmitInput = {
  readonly workingDirectory: string;
  readonly plan: DelegationPlan;
};

export type AdmissionForInput = StartAndAdmitInput & {
  readonly declaration: DelegationAttemptDeclaration;
};

export type RecordedAttempt = {
  readonly terminalKind: TaskTerminalKind;
  readonly processing: AgentAttemptProcessingReference;
};

export type RecordDeclarationInput = {
  readonly runDirectory: string;
  readonly plan: DelegationPlan;
  readonly declaration: DelegationAttemptDeclaration;
  readonly terminalKind: TaskTerminalKind;
  readonly recorded: Map<string, RecordedAttempt>;
};

export type BarrierEvidenceInput = {
  readonly plan: DelegationPlan;
  readonly recorded: ReadonlyMap<string, RecordedAttempt>;
};
