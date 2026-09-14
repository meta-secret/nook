import type { DelegationRunFinalization } from './delegation-aggregation.ts';
import type { VerifiedBarrierAttempt } from './attempt-verification.ts';
import type {
  AgentAttemptParent,
  MaterializedViewReference,
  ProjectionReference,
  TaskTerminalKind,
} from './domain.ts';
import type {
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
} from './delegation-domain.ts';
import type { LoadedDelegationRunState } from './delegation-run-journal.ts';
import type { PinnedDevBaseEvidence } from '../lib/base-evidence.ts';
import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';

export type DelegationFinalizationRequest = PinnedDevBaseEvidence & {
  readonly runId: string;
  readonly sourceCommit: string;
  /** Observed attempt frontier retained for journal-artifact verification only. */
  readonly featureHeadSha: string;
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

export type DelegationRunResult = PinnedDevBaseEvidence & {
  readonly schemaVersion: typeof DelegationRunFinalization.DELEGATION_RUN_RESULT_SCHEMA_VERSION;
  readonly runId: string;
  readonly sourceCommit: string;
  /** Observed attempt frontier; the canonical feature branch remains authoritative. */
  readonly featureHeadSha: string;
  readonly planSha256: string;
  readonly rootMaterializer: DelegationAttemptIdentity;
  readonly attempts: readonly DelegationFinalizedAttempt[];
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
  readonly materializedView: ProjectionReference;
};

export type DelegationRunResultV1 = {
  readonly schemaVersion: typeof DelegationRunFinalization.LEGACY_DELEGATION_RUN_RESULT_SCHEMA_VERSION;
  readonly runId: string;
  readonly sourceCommit: string;
  readonly originMainSha: string;
  readonly pinnedLocalDevSha: string;
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

export type FinalizeWhileLockedInput = {
  readonly loaded: LoadedDelegationRunState;
  readonly featureHeadSha: string;
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
};

export type VerifiedPlannedAttempt = {
  readonly declaration: DelegationAttemptDeclaration;
  readonly verified: VerifiedBarrierAttempt;
};

export type RecursiveBarrierInput = {
  readonly plan: DelegationPlan;
  readonly verifiedAttempts: ReadonlyMap<string, VerifiedPlannedAttempt>;
};

export type ExactBarrierEvidenceInput = RecursiveBarrierInput & {
  readonly barrierEvidence: readonly DelegationBarrierEvidence[];
};

export type VisitBarrierInput = {
  readonly identity: DelegationAttemptIdentity;
  readonly declarations: ReadonlyMap<string, DelegationAttemptDeclaration>;
  readonly verifiedAttempts: ReadonlyMap<string, VerifiedPlannedAttempt>;
  readonly visited: Set<string>;
};

export type FinalizedAttemptInput = {
  readonly declaration: DelegationAttemptDeclaration;
  readonly verified: VerifiedBarrierAttempt;
};

export type FinalizationPaths = {
  readonly resultPath: string;
  readonly viewPath: string;
};

export type WriteOrVerifyFinalizationInput = {
  readonly paths: FinalizationPaths;
  readonly resultSerialized: string;
  readonly viewSerialized: string;
};

export type WriteOrVerifyProjectionInput = {
  readonly path: string;
  readonly expected: string;
  readonly maxBytes: number;
};

/** Reads and validates structured values from the delegation boundary. */
export class DelegationFinalizationRecordReader {
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
    if (!UntrustedYamlBoundary.isList(value)) {
      throw new Error(`Delegation finalization field must be an array: ${key}`);
    }
    return value;
  }
}
