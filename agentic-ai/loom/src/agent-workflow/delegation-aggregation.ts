import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VerifiedAttemptArtifacts } from './attempt-verification.ts';
import type {
  ReadParentAttemptArgs,
  ReadVerifiedProjectionArgs,
  VerifiedBarrierAttempt,
} from './attempt-verification.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from './agent-attempt-version.ts';
import {
  AgentAttemptAdapterKind,
  MaterializedViewPresence,
  TaskTerminalKind,
} from './domain.ts';
import type {
  AgentAttemptParent,
  MaterializedViewReference,
  ProjectionReference,
} from './domain.ts';
import {
  DelegationRunEventKind,
  DelegationPlanContract,
} from './delegation-domain.ts';
import type {
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
} from './delegation-domain.ts';
import { DelegationRunJournal } from './delegation-run-journal.ts';
import type {
  DelegationLifecycleLockInput,
  LoadDelegationPlanInput,
  LoadedDelegationRunState,
} from './delegation-run-journal.ts';
import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';

/** Owns the delegation run finalization registry and its capability transitions. */
export class DelegationRunFinalization {
  private constructor() {}
  private static readonly FINALIZATION_REQUEST_FIELDS = [
    'runId',
    'sourceCommit',
    'barrierEvidence',
  ] as const;

  private static readonly BARRIER_EVIDENCE_FIELDS = [
    'parent',
    'children',
  ] as const;

  private static readonly CHILD_EVIDENCE_FIELDS = [
    'identity',
    'terminalKind',
    'resultSha256',
    'viewSha256',
  ] as const;

  private static readonly IDENTITY_FIELDS = [
    'task',
    'agent',
    'attempt',
  ] as const;

  private static readonly TERMINAL_KINDS = new Set<string>(
    Object.values(TaskTerminalKind),
  );

  private static readonly DIRECTORY_ENTRY_OPTIONS: {
    readonly withFileTypes: true;
  } = {
    withFileTypes: true,
  };

  private static readonly EXCLUSIVE_UTF8_WRITE_OPTIONS: {
    readonly encoding: 'utf8';
    readonly flag: 'wx';
  } = { encoding: 'utf8', flag: 'wx' };

  private static readonly MAX_RUN_RESULT_BYTES = 524_288;

  private static readonly MAX_RUN_VIEW_BYTES = 196_609;

  private static readonly MAX_FINALIZATION_REQUEST_BYTES = 262_144;

  static readonly DELEGATION_RUN_RESULT_SCHEMA_VERSION = '1.0.0';

  static decodeDelegationFinalizationRequest(
    serialized: string,
  ): DelegationFinalizationRequest {
    if (
      Buffer.byteLength(serialized, 'utf8') >
      DelegationRunFinalization.MAX_FINALIZATION_REQUEST_BYTES
    ) {
      throw new Error('Delegation finalization request is not bounded.');
    }
    const transport = JSON.parse(serialized) as UntrustedYamlNode;
    if (!UntrustedYamlBoundary.isRecord(transport)) {
      throw new Error('Delegation finalization request must be an object.');
    }
    const reader = new RecordReader(transport);
    DelegationRunFinalization.assertExactKeys(reader.record)(
      DelegationRunFinalization.FINALIZATION_REQUEST_FIELDS,
    );
    const runId = reader.string('runId');
    const sourceCommit = reader.string('sourceCommit');
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) ||
      !/^[0-9a-f]{40}$/.test(sourceCommit)
    ) {
      throw new Error('Delegation finalization request identity is invalid.');
    }
    return {
      runId,
      sourceCommit,
      barrierEvidence: reader
        .array('barrierEvidence')
        .map(DelegationRunFinalization.decodeBarrierEvidence),
    };
  }

  private static decodeBarrierEvidence(
    node: UntrustedYamlNode,
  ): DelegationBarrierEvidence {
    const reader = new RecordReader(
      DelegationRunFinalization.requireRecord(node),
    );
    DelegationRunFinalization.assertExactKeys(reader.record)(
      DelegationRunFinalization.BARRIER_EVIDENCE_FIELDS,
    );
    return {
      parent: DelegationRunFinalization.decodeIdentity(reader.node('parent')),
      children: reader
        .array('children')
        .map(DelegationRunFinalization.decodeChildEvidence),
    };
  }

  private static decodeChildEvidence(
    node: UntrustedYamlNode,
  ): DelegationChildTerminalEvidence {
    const reader = new RecordReader(
      DelegationRunFinalization.requireRecord(node),
    );
    DelegationRunFinalization.assertExactKeys(reader.record)(
      DelegationRunFinalization.CHILD_EVIDENCE_FIELDS,
    );
    const terminalKind = reader.string('terminalKind');
    if (!DelegationRunFinalization.TERMINAL_KINDS.has(terminalKind)) {
      throw new Error('Delegation barrier terminal kind is invalid.');
    }
    return {
      identity: DelegationRunFinalization.decodeIdentity(
        reader.node('identity'),
      ),
      terminalKind: terminalKind as TaskTerminalKind,
      resultSha256: reader.sha256('resultSha256'),
      viewSha256: reader.sha256('viewSha256'),
    };
  }

  private static decodeIdentity(
    node: UntrustedYamlNode,
  ): DelegationAttemptIdentity {
    const reader = new RecordReader(
      DelegationRunFinalization.requireRecord(node),
    );
    DelegationRunFinalization.assertExactKeys(reader.record)(
      DelegationRunFinalization.IDENTITY_FIELDS,
    );
    const identity: DelegationAttemptIdentity = {
      task: reader.string('task'),
      agent: reader.string('agent'),
      attempt: reader.number('attempt'),
    };
    return identity;
  }

  static async finalizeDelegationRun(
    input: FinalizeDelegationRunInput,
  ): Promise<DelegationFinalizationReceipt> {
    const loadInput: LoadDelegationPlanInput = {
      workingDirectory: input.workingDirectory,
      runId: input.request.runId,
    };
    const loaded = await DelegationRunJournal.loadDelegationRunState(loadInput);
    if (loaded.plan.sourceCommit !== input.request.sourceCommit) {
      throw new Error('Delegation finalization source identity is invalid.');
    }
    const lockInput: DelegationLifecycleLockInput = {
      runDirectory: loaded.runDirectory,
    };
    const lease =
      await DelegationRunJournal.acquireDelegationLifecycleLock(lockInput);
    try {
      lease.assertHeld(loaded.runDirectory);
      const reloaded =
        await DelegationRunJournal.loadDelegationRunState(loadInput);
      if (reloaded.plan.sourceCommit !== input.request.sourceCommit) {
        throw new Error('Delegation finalization source identity is invalid.');
      }
      const lockedInput: FinalizeWhileLockedInput = {
        loaded: reloaded,
        barrierEvidence: input.request.barrierEvidence,
      };
      return await DelegationRunFinalization.finalizeWhileLocked(lockedInput);
    } finally {
      await lease.release();
    }
  }

  private static async finalizeWhileLocked(
    input: FinalizeWhileLockedInput,
  ): Promise<DelegationFinalizationReceipt> {
    await DelegationRunFinalization.cleanupStaleFinalizationTemps(
      input.loaded.runDirectory,
    );
    DelegationRunFinalization.assertExactAdmissions(input.loaded);
    const verifiedAttempts = await DelegationRunFinalization.verifyEveryAttempt(
      input.loaded,
    );
    await DelegationRunFinalization.assertExactAttemptStorage(input.loaded);
    const recursiveInput: RecursiveBarrierInput = {
      plan: input.loaded.plan,
      verifiedAttempts,
    };
    DelegationRunFinalization.assertRecursiveBarriers(recursiveInput);
    const barrierEvidenceInput: ExactBarrierEvidenceInput = {
      plan: input.loaded.plan,
      verifiedAttempts,
      barrierEvidence: input.barrierEvidence,
    };
    const canonicalBarrierEvidence =
      DelegationRunFinalization.assertExactBarrierEvidence(
        barrierEvidenceInput,
      );
    const rootKey = DelegationPlanContract.delegationAttemptIdentityKey(
      input.loaded.plan.rootMaterializer,
    );
    const root = verifiedAttempts.get(rootKey);
    if (!root || root.verified.terminal.kind !== TaskTerminalKind.Completed) {
      throw new Error(
        'Delegation root materializer must complete with an agent-authored view.',
      );
    }
    const viewSerialized = root.verified.viewMarkdown;
    const viewSha256 = DelegationRunFinalization.sha256(viewSerialized);
    const result: DelegationRunResult = {
      schemaVersion:
        DelegationRunFinalization.DELEGATION_RUN_RESULT_SCHEMA_VERSION,
      runId: input.loaded.plan.runId,
      sourceCommit: input.loaded.plan.sourceCommit,
      planSha256: input.loaded.planSha256,
      rootMaterializer: input.loaded.plan.rootMaterializer,
      attempts: input.loaded.plan.attempts.map((declaration) => {
        const key = DelegationPlanContract.delegationAttemptIdentityKey(
          declaration.identity,
        );
        const attempt = verifiedAttempts.get(key);
        if (!attempt)
          throw new Error(`Delegation terminal evidence is missing: ${key}`);
        const finalizedInput: FinalizedAttemptInput = {
          declaration,
          verified: attempt.verified,
        };
        return DelegationRunFinalization.finalizedAttempt(finalizedInput);
      }),
      barrierEvidence: canonicalBarrierEvidence,
      materializedView: { path: 'view.md', sha256: viewSha256 },
    };
    const resultSerialized = `${JSON.stringify(result)}\n`;
    const paths: FinalizationPaths = {
      resultPath: join(input.loaded.runDirectory, 'run-result.json'),
      viewPath: join(input.loaded.runDirectory, 'view.md'),
    };
    const projectionInput: WriteOrVerifyFinalizationInput = {
      paths,
      resultSerialized,
      viewSerialized,
    };
    await DelegationRunFinalization.writeOrVerifyFinalization(projectionInput);
    return {
      runDirectory: input.loaded.runDirectory,
      ...paths,
      resultSha256: DelegationRunFinalization.sha256(resultSerialized),
      viewSha256,
      result,
    };
  }

  private static assertExactAdmissions(loaded: LoadedDelegationRunState): void {
    const admissions = loaded.events.filter(
      (event) => event.kind === DelegationRunEventKind.AttemptAdmitted,
    );
    if (admissions.length !== loaded.plan.attempts.length) {
      throw new Error(
        'Delegation finalization requires every planned admission.',
      );
    }
    const admitted = new Set(
      admissions.map((event) =>
        DelegationPlanContract.delegationAttemptIdentityKey(
          event.declaration.identity,
        ),
      ),
    );
    for (const declaration of loaded.plan.attempts) {
      if (
        !admitted.has(
          DelegationPlanContract.delegationAttemptIdentityKey(
            declaration.identity,
          ),
        )
      ) {
        throw new Error(
          'Delegation finalization is missing a planned admission.',
        );
      }
    }
  }

  private static async verifyEveryAttempt(
    loaded: LoadedDelegationRunState,
  ): Promise<ReadonlyMap<string, VerifiedPlannedAttempt>> {
    const attempts = new Map<string, VerifiedPlannedAttempt>();
    for (const declaration of loaded.plan.attempts) {
      const verification: ReadParentAttemptArgs = {
        runDirectory: loaded.runDirectory,
        runId: loaded.plan.runId,
        workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
        sourceCommit: loaded.plan.sourceCommit,
        identity: { ...declaration.identity, depth: declaration.depth },
      };
      const verified =
        await VerifiedAttemptArtifacts.readVerifiedBarrierAttempt(verification);
      if (
        verified.firstEvent.adapter !==
          AgentAttemptAdapterKind.GenericDelegationRecorder ||
        JSON.stringify(verified.firstEvent.parent) !==
          JSON.stringify(declaration.parent)
      ) {
        throw new Error('Delegation terminal evidence lineage is invalid.');
      }
      const planned: VerifiedPlannedAttempt = { declaration, verified };
      attempts.set(
        DelegationPlanContract.delegationAttemptIdentityKey(
          declaration.identity,
        ),
        planned,
      );
    }
    return attempts;
  }

  private static assertRecursiveBarriers(input: RecursiveBarrierInput): void {
    const declarations = new Map(
      input.plan.attempts.map((declaration) => [
        DelegationPlanContract.delegationAttemptIdentityKey(
          declaration.identity,
        ),
        declaration,
      ]),
    );
    const visited = new Set<string>();
    const visitInput: VisitBarrierInput = {
      identity: input.plan.rootMaterializer,
      declarations,
      verifiedAttempts: input.verifiedAttempts,
      visited,
    };
    DelegationRunFinalization.visitBarrier(visitInput);
    if (visited.size !== input.plan.attempts.length) {
      throw new Error(
        'Delegation terminal barriers do not cover the whole plan.',
      );
    }
  }

  private static assertExactBarrierEvidence(
    input: ExactBarrierEvidenceInput,
  ): readonly DelegationBarrierEvidence[] {
    if (input.barrierEvidence.length !== input.plan.attempts.length) {
      throw new Error('Delegation barrier evidence must cover every parent.');
    }
    const canonical: DelegationBarrierEvidence[] = [];
    for (const [index, declaration] of input.plan.attempts.entries()) {
      const evidence = input.barrierEvidence[index];
      if (
        !evidence ||
        DelegationPlanContract.delegationAttemptIdentityKey(evidence.parent) !==
          DelegationPlanContract.delegationAttemptIdentityKey(
            declaration.identity,
          ) ||
        evidence.children.length !== declaration.terminalBarrier.attempts.length
      ) {
        throw new Error('Delegation barrier evidence order is invalid.');
      }
      const children: DelegationChildTerminalEvidence[] = [];
      for (const [
        childIndex,
        childIdentity,
      ] of declaration.terminalBarrier.attempts.entries()) {
        const childEvidence = evidence.children[childIndex];
        const verified = input.verifiedAttempts.get(
          DelegationPlanContract.delegationAttemptIdentityKey(childIdentity),
        );
        if (
          !childEvidence ||
          !verified ||
          verified.verified.view.presence !==
            MaterializedViewPresence.Recorded ||
          DelegationPlanContract.delegationAttemptIdentityKey(
            childEvidence.identity,
          ) !==
            DelegationPlanContract.delegationAttemptIdentityKey(
              childIdentity,
            ) ||
          childEvidence.terminalKind !== verified.verified.terminal.kind ||
          childEvidence.resultSha256 !== verified.verified.result.sha256 ||
          childEvidence.viewSha256 !== verified.verified.view.projection.sha256
        ) {
          throw new Error(
            'Delegation barrier evidence does not match child projections.',
          );
        }
        const child: DelegationChildTerminalEvidence = {
          identity: childIdentity,
          terminalKind: verified.verified.terminal.kind,
          resultSha256: verified.verified.result.sha256,
          viewSha256: verified.verified.view.projection.sha256,
        };
        children.push(child);
      }
      const barrier: DelegationBarrierEvidence = {
        parent: declaration.identity,
        children,
      };
      canonical.push(barrier);
    }
    return canonical;
  }

  private static visitBarrier(input: VisitBarrierInput): void {
    const key = DelegationPlanContract.delegationAttemptIdentityKey(
      input.identity,
    );
    const declaration = input.declarations.get(key);
    if (
      !declaration ||
      !input.verifiedAttempts.has(key) ||
      input.visited.has(key)
    ) {
      throw new Error('Delegation terminal barrier evidence is invalid.');
    }
    input.visited.add(key);
    for (const child of declaration.terminalBarrier.attempts) {
      const childInput: VisitBarrierInput = { ...input, identity: child };
      DelegationRunFinalization.visitBarrier(childInput);
    }
  }

  private static finalizedAttempt(
    input: FinalizedAttemptInput,
  ): DelegationFinalizedAttempt {
    return {
      identity: input.declaration.identity,
      depth: input.declaration.depth,
      parent: input.declaration.parent,
      terminalKind: input.verified.terminal.kind,
      result: input.verified.result,
      view: input.verified.view,
    };
  }

  private static async assertExactAttemptStorage(
    loaded: LoadedDelegationRunState,
  ): Promise<void> {
    const expected = new Map<string, Set<string>>();
    for (const declaration of loaded.plan.attempts) {
      const [attempts = new Set<string>()] = [
        expected.get(declaration.identity.task),
      ];
      attempts.add(`attempt-${declaration.identity.attempt}`);
      expected.set(declaration.identity.task, attempts);
    }
    const agentsPath = join(loaded.runDirectory, 'agents');
    const taskEntries = await readdir(
      agentsPath,
      DelegationRunFinalization.DIRECTORY_ENTRY_OPTIONS,
    );
    if (
      taskEntries.length !== expected.size ||
      taskEntries.some(
        (entry) => !entry.isDirectory() || !expected.has(entry.name),
      )
    ) {
      throw new Error('Delegation run contains unplanned attempt evidence.');
    }
    for (const taskEntry of taskEntries) {
      const attemptEntries = await readdir(
        join(agentsPath, taskEntry.name),
        DelegationRunFinalization.DIRECTORY_ENTRY_OPTIONS,
      );
      const plannedAttempts = expected.get(taskEntry.name);
      if (
        !plannedAttempts ||
        attemptEntries.length !== plannedAttempts.size ||
        attemptEntries.some(
          (entry) => !entry.isDirectory() || !plannedAttempts.has(entry.name),
        )
      ) {
        throw new Error('Delegation run contains unplanned attempt evidence.');
      }
    }
  }

  private static async writeOrVerifyFinalization(
    input: WriteOrVerifyFinalizationInput,
  ): Promise<void> {
    const viewInput: WriteOrVerifyProjectionInput = {
      path: input.paths.viewPath,
      expected: input.viewSerialized,
      maxBytes: DelegationRunFinalization.MAX_RUN_VIEW_BYTES,
    };
    await DelegationRunFinalization.writeOrVerifyProjection(viewInput);
    const resultInput: WriteOrVerifyProjectionInput = {
      path: input.paths.resultPath,
      expected: input.resultSerialized,
      maxBytes: DelegationRunFinalization.MAX_RUN_RESULT_BYTES,
    };
    await DelegationRunFinalization.writeOrVerifyProjection(resultInput);
  }

  private static async writeOrVerifyProjection(
    input: WriteOrVerifyProjectionInput,
  ): Promise<void> {
    if (await DelegationRunFinalization.filesystemPathExists(input.path)) {
      const readInput: ReadVerifiedProjectionArgs = {
        runDirectory: join(input.path, '..'),
        path: input.path,
        maxBytes: input.maxBytes,
      };
      const existing =
        await VerifiedAttemptArtifacts.readVerifiedProjection(readInput);
      if (existing !== input.expected) {
        throw new Error('Delegation finalization projection is not exact.');
      }
      return;
    }
    const temporaryPath = `${input.path}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(
        temporaryPath,
        input.expected,
        DelegationRunFinalization.EXCLUSIVE_UTF8_WRITE_OPTIONS,
      );
      await rename(temporaryPath, input.path);
    } finally {
      await DelegationRunFinalization.unlinkIfPresent(temporaryPath);
    }
  }

  private static async cleanupStaleFinalizationTemps(
    runDirectory: string,
  ): Promise<void> {
    const entries = await readdir(
      runDirectory,
      DelegationRunFinalization.DIRECTORY_ENTRY_OPTIONS,
    );
    for (const entry of entries) {
      if (!DelegationRunFinalization.isFinalizationTemp(entry.name)) continue;
      const path = join(runDirectory, entry.name);
      const status = await lstat(path);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new Error(
          'Delegation finalization temporary projection is unsafe.',
        );
      }
      await unlink(path);
    }
  }

  private static isFinalizationTemp(name: string): boolean {
    if (name === 'view.md.tmp' || name === 'run-result.json.tmp') return true;
    const match = name.match(
      /^(?:view\.md|run-result\.json)\.tmp-([1-9][0-9]*)-[0-9a-f-]{36}$/,
    );
    if (!match) return false;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid)) {
      throw new Error('Delegation finalization temporary owner is invalid.');
    }
    return true;
  }

  private static async unlinkIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }

  private static async filesystemPathExists(path: string): Promise<boolean> {
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

  private static requireRecord(node: UntrustedYamlNode): UntrustedYamlMap {
    if (!UntrustedYamlBoundary.isRecord(node)) {
      throw new Error(
        'Delegation finalization structured value must be an object.',
      );
    }
    return node;
  }

  private static assertExactKeys(
    record: UntrustedYamlMap,
  ): (expected: readonly string[]) => void {
    return (expected) => {
      const actual = new Set(Object.keys(record));
      if (
        actual.size !== expected.length ||
        expected.some((key) => !actual.has(key))
      ) {
        throw new Error(
          'Delegation finalization structured value has unsupported fields.',
        );
      }
    };
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

export type DelegationFinalizationRequest = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
};

export type DelegationChildTerminalEvidence = {
  readonly identity: DelegationAttemptIdentity;
  readonly terminalKind: TaskTerminalKind;
  readonly resultSha256: string;
  readonly viewSha256: string;
};

export type DelegationBarrierEvidence = {
  readonly parent: DelegationAttemptIdentity;
  readonly children: readonly DelegationChildTerminalEvidence[];
};

export type FinalizeDelegationRunInput = {
  readonly workingDirectory: string;
  readonly request: DelegationFinalizationRequest;
};

export type DelegationFinalizedAttempt = {
  readonly identity: DelegationAttemptIdentity;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly terminalKind: TaskTerminalKind;
  readonly result: ProjectionReference;
  readonly view: MaterializedViewReference;
};

export type DelegationRunResult = {
  readonly schemaVersion: typeof DelegationRunFinalization.DELEGATION_RUN_RESULT_SCHEMA_VERSION;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly planSha256: string;
  readonly rootMaterializer: DelegationAttemptIdentity;
  readonly attempts: readonly DelegationFinalizedAttempt[];
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
  readonly materializedView: ProjectionReference;
};

export type DelegationFinalizationReceipt = {
  readonly runDirectory: string;
  readonly resultPath: string;
  readonly viewPath: string;
  readonly resultSha256: string;
  readonly viewSha256: string;
  readonly result: DelegationRunResult;
};

type FinalizeWhileLockedInput = {
  readonly loaded: LoadedDelegationRunState;
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
};

type VerifiedPlannedAttempt = {
  readonly declaration: DelegationAttemptDeclaration;
  readonly verified: VerifiedBarrierAttempt;
};

type RecursiveBarrierInput = {
  readonly plan: DelegationPlan;
  readonly verifiedAttempts: ReadonlyMap<string, VerifiedPlannedAttempt>;
};

type ExactBarrierEvidenceInput = RecursiveBarrierInput & {
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
};

type VisitBarrierInput = {
  readonly identity: DelegationAttemptIdentity;
  readonly declarations: ReadonlyMap<string, DelegationAttemptDeclaration>;
  readonly verifiedAttempts: ReadonlyMap<string, VerifiedPlannedAttempt>;
  readonly visited: Set<string>;
};

type FinalizedAttemptInput = {
  readonly declaration: DelegationAttemptDeclaration;
  readonly verified: VerifiedBarrierAttempt;
};

type FinalizationPaths = {
  readonly resultPath: string;
  readonly viewPath: string;
};

type WriteOrVerifyFinalizationInput = {
  readonly paths: FinalizationPaths;
  readonly resultSerialized: string;
  readonly viewSerialized: string;
};

type WriteOrVerifyProjectionInput = {
  readonly path: string;
  readonly expected: string;
  readonly maxBytes: number;
};

class RecordReader {
  readonly record: UntrustedYamlMap;

  constructor(record: UntrustedYamlMap) {
    this.record = record;
  }

  node(key: string): UntrustedYamlNode {
    const propertyInput: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = UntrustedYamlBoundary.property(propertyInput);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      throw new Error(`Delegation finalization field is missing: ${key}`);
    }
    return property.value;
  }

  string(key: string): string {
    const value = this.node(key);
    if (typeof value !== 'string') {
      throw new Error(`Delegation finalization field must be a string: ${key}`);
    }
    return value;
  }

  sha256(key: string): string {
    const value = this.string(key);
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throw new Error(`Delegation finalization digest is invalid: ${key}`);
    }
    return value;
  }

  number(key: string): number {
    const value = this.node(key);
    if (typeof value !== 'number') {
      throw new Error(`Delegation finalization field must be a number: ${key}`);
    }
    return value;
  }

  array(key: string): readonly UntrustedYamlNode[] {
    const value = this.node(key);
    if (!Array.isArray(value)) {
      throw new Error(`Delegation finalization field must be an array: ${key}`);
    }
    return value;
  }
}
