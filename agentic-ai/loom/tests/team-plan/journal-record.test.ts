import { expect, test } from 'bun:test';

import {
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryProviderSubmissionKind,
  TeamKey,
} from '../../src/module-delivery/index.ts';
import {
  TeamPlanRecordKind,
  assertTeamPlanRecord,
} from '../../src/team-plan/domain.ts';
import { MAX_SERIALIZED_TEAM_PLAN_RECORD_BYTES } from '../../src/team-plan/record-limits.ts';

import type { TeamPlanRecord } from '../../src/team-plan/domain.ts';

function providerRecords(): readonly TeamPlanRecord[] {
  const identity = 'a'.repeat(40);
  const workspace = {
    sourceRepositoryRoot: '/source',
    ownedWorkspaceRoot: '/workspaces',
    worktreePath: '/workspaces/provider',
    worktreeAdminDirectory: '/source/.git/worktrees/provider',
    gitCommonDirectory: '/source/.git',
    worktreeId: 'provider',
    planDigest: 'b'.repeat(64),
    taskId: 'provider',
    attempt: 1,
    baselineCommit: identity,
  };
  return [
    {
      kind: TeamPlanRecordKind.Provider,
      submission: {
        kind: ModuleDeliveryProviderSubmissionKind.Write,
        generation: 1,
        acceptedByTeam: TeamKey.Ai,
        verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
        handoff: {
          taskId: workspace.taskId,
          attempt: workspace.attempt,
          planDigest: workspace.planDigest,
          baselineCommit: workspace.baselineCommit,
          commit: identity,
          workspace,
        },
      },
    },
    {
      kind: TeamPlanRecordKind.Provider,
      submission: {
        kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
        schemaVersion: 1,
        taskId: 'provider',
        attempt: 1,
        generation: 1,
        planDigest: 'b'.repeat(64),
        sourceCommit: identity,
        producerTeam: TeamKey.Ai,
        functionalOwner: TeamKey.Ai,
        acceptanceOwner: TeamKey.Ai,
        acceptanceRequirements: ['accepted'],
        claimIdentities: [{ claim: '/source', contentDigest: 'c'.repeat(64) }],
        acceptedProviderEvidence: [],
        artifactIdentity: 'provider/report.json',
        artifactDigest: 'd'.repeat(64),
        verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
        evidence: ['accepted'],
      },
    },
  ];
}

test('validates both provider variants and every nested identity', () => {
  const [writeRecord, evidenceRecord] = providerRecords();
  if (
    !writeRecord ||
    writeRecord.kind !== TeamPlanRecordKind.Provider ||
    writeRecord.submission.kind !== ModuleDeliveryProviderSubmissionKind.Write
  )
    throw new Error('Provider record fixture is malformed.');
  if (
    !evidenceRecord ||
    evidenceRecord.kind !== TeamPlanRecordKind.Provider ||
    evidenceRecord.submission.kind !==
      ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence
  )
    throw new Error('Provider record fixture is malformed.');
  assertTeamPlanRecord(writeRecord);
  assertTeamPlanRecord(evidenceRecord);
  const malformedWrite = structuredClone(writeRecord.submission);
  Object.assign(malformedWrite.handoff.workspace, { worktreePath: 1 });
  expect(() =>
    assertTeamPlanRecord({
      kind: TeamPlanRecordKind.Provider,
      submission: malformedWrite,
    }),
  ).toThrow('fields are invalid');
  const malformedEvidence = structuredClone(evidenceRecord.submission);
  Object.assign(malformedEvidence.claimIdentities[0] ?? {}, {
    contentDigest: 1,
  });
  expect(() =>
    assertTeamPlanRecord({
      kind: TeamPlanRecordKind.Provider,
      submission: malformedEvidence,
    }),
  ).toThrow('fields are invalid');
  const acceptedWrite = JSON.parse(
    JSON.stringify({ kind: TeamPlanRecordKind.AcceptedWrite }),
  ) as TeamPlanRecord;
  expect(() => assertTeamPlanRecord(acceptedWrite)).toThrow(
    'fields are invalid',
  );
  const evidenceSubmission = structuredClone(evidenceRecord.submission);
  const acceptedIdentity = {
    ...evidenceSubmission,
    verifiedHeadCommit: evidenceSubmission.sourceCommit,
    sourceProvenanceDigest: 'e'.repeat(64),
    acceptedProviderEvidence: [],
  };
  const overboundEvidence = {
    ...evidenceSubmission,
    acceptedProviderEvidence: Array.from({ length: 129 }, () =>
      structuredClone(acceptedIdentity),
    ),
  };
  expect(() =>
    assertTeamPlanRecord({
      kind: TeamPlanRecordKind.Provider,
      submission: overboundEvidence,
    }),
  ).toThrow('ancestry is too large');
});

test('rejects records outside the bounded command envelope', () => {
  const [writeRecord] = providerRecords();
  if (
    !writeRecord ||
    writeRecord.kind !== TeamPlanRecordKind.Provider ||
    writeRecord.submission.kind !== ModuleDeliveryProviderSubmissionKind.Write
  )
    throw new Error('Provider record fixture is malformed.');
  const submission = structuredClone(writeRecord.submission);
  const oversizedSubmission = {
    ...submission,
    handoff: {
      ...submission.handoff,
      workspace: {
        ...submission.handoff.workspace,
        worktreePath: 'x'.repeat(MAX_SERIALIZED_TEAM_PLAN_RECORD_BYTES),
      },
    },
  };
  expect(() =>
    assertTeamPlanRecord({ ...writeRecord, submission: oversizedSubmission }),
  ).toThrow('fields are invalid');
});
